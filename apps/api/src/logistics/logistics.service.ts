import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import {
  hasWorkspace,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import { DurableJobsService } from "../platform/durable-jobs.service.js";
import { OutboxService } from "../platform/outbox.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type {
  CompareLogisticsDto,
  CreateLogisticsExportDto,
  CreateLogisticsPlanDto,
  CreateLogisticsVersionDto,
  ExpectedVersionDto,
  LogisticsListQuery,
  OptimizePlanDto,
  SaveLogisticsDraftDto,
} from "./logistics.dto.js";
import { planFlatOnFace, validatePlacements } from "./flat-loader.js";

const DEFAULT_UNIT = {
  length: 12000,
  width: 2400,
  height: 2600,
  maxWeight: 25000,
  name: "12m Flatbed",
};
@Injectable()
export class LogisticsService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
    private readonly jobs: DurableJobsService,
    private readonly outbox: OutboxService,
  ) {}
  async list(i: CustomerIdentity, q: LogisticsListQuery) {
    this.require(i, permissions.logisticsView);
    const offset = q.offset ?? (q.page - 1) * q.limit;
    const where: Prisma.LogisticsPlanWhereInput = {
      countryCode: { in: [...i.countryCodes] },
      ...(q.search
        ? { planRef: { contains: q.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.logisticsPlan.count({ where }),
      this.db.logisticsPlan.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    return {
      data: rows.map(planDto),
      meta: {
        page: Math.floor(offset / q.limit) + 1,
        offset,
        limit: q.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }
  async get(i: CustomerIdentity, id: string) {
    this.require(i, permissions.logisticsView);
    const plan = await this.plan(i, id);
    const versions = await this.db.logisticsPlanVersion.findMany({
      where: { logisticsPlanId: id },
      orderBy: { versionNo: "desc" },
    });
    return { data: { ...planDto(plan), versions: versions.map(versionDto) } };
  }
  async create(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateLogisticsPlanDto,
  ) {
    this.require(i, permissions.logisticsCreate);
    key = requireKey(key);
    const requestHash = hash(b);
    return this.txs.run(i, async (tx) => {
      const replay = await this.replay(
        tx,
        i,
        "post_logistics_plans",
        key,
        requestHash,
      );
      if (replay) return { data: planDto(await this.planTx(tx, i, replay)) };
      const source = await this.source(tx, i, b);
      const id = randomUUID();
      const plan = await tx.logisticsPlan.create({
        data: {
          id,
          planRef: `LP-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          sourceTypeCode: b.sourceTypeCode,
          sourceId: b.sourceResourceId ?? null,
          countryCode: source.countryCode,
          createdByUserId: i.userId,
        },
      });
      const version = await tx.logisticsPlanVersion.create({
        data: {
          logisticsPlanId: plan.id,
          versionNo: 1,
          createdByUserId: i.userId,
          completenessModeCode: "PARTIAL",
        },
      });
      if (b.manualLines?.length)
        await this.replaceLines(tx, version.id, b.manualLines);
      await this.remember(
        tx,
        i,
        "post_logistics_plans",
        key,
        requestHash,
        plan.id,
      );
      await this.record(
        tx,
        i,
        "LOGISTICS_PLAN_CREATED",
        "LogisticsPlan",
        plan.id,
        { sourceTypeCode: b.sourceTypeCode, planningOnly: true },
      );
      return { data: planDto(plan) };
    });
  }
  async createVersion(
    i: CustomerIdentity,
    key: string | undefined,
    planId: string,
    b: CreateLogisticsVersionDto,
  ) {
    this.require(i, permissions.logisticsEdit);
    key = requireKey(key);
    return this.txs.run(i, async (tx) => {
      await this.planTx(tx, i, planId);
      const requestHash = hash({ planId, b }),
        replay = await this.replay(
          tx,
          i,
          "post_logistics_plan_versions",
          key,
          requestHash,
        );
      if (replay)
        return {
          data: versionDto(
            await tx.logisticsPlanVersion.findUniqueOrThrow({
              where: { id: replay },
            }),
          ),
        };
      const max =
        (
          await tx.logisticsPlanVersion.aggregate({
            where: { logisticsPlanId: planId },
            _max: { versionNo: true },
          })
        )._max.versionNo ?? 0;
      const row = await tx.logisticsPlanVersion.create({
        data: {
          logisticsPlanId: planId,
          versionNo: max + 1,
          createdByUserId: i.userId,
          completenessModeCode: "PARTIAL",
        },
      });
      if (b.cloneFromVersionId) {
        const source = await tx.logisticsPlanVersion.findFirst({
          where: { id: b.cloneFromVersionId, logisticsPlanId: planId },
        });
        if (!source) missing("LOGISTICS_VERSION_NOT_FOUND");
        const lines = await tx.logisticsPlanLine.findMany({
          where: { planVersionId: source.id },
        });
        for (const l of lines)
          await tx.logisticsPlanLine.create({
            data: {
              planVersionId: row.id,
              productId: l.productId,
              qty: l.qty,
              lengthMm: l.lengthMm,
              widthMm: l.widthMm,
              thicknessMm: l.thicknessMm,
              weightKg: l.weightKg,
              orientationCode: l.orientationCode,
            },
          });
        const units = await tx.logisticsTransportUnit.findMany({
          where: { planVersionId: source.id },
        });
        for (const u of units)
          await tx.logisticsTransportUnit.create({
            data: {
              planVersionId: row.id,
              templateId: u.templateId,
              instanceNo: u.instanceNo,
              nameSnapshot: u.nameSnapshot,
              lengthMm: u.lengthMm,
              widthMm: u.widthMm,
              heightMm: u.heightMm,
              maxWeightKg: u.maxWeightKg,
            },
          });
      }
      await this.remember(
        tx,
        i,
        "post_logistics_plan_versions",
        key,
        requestHash,
        row.id,
      );
      await this.record(
        tx,
        i,
        "LOGISTICS_VERSION_CREATED",
        "LogisticsPlanVersion",
        row.id,
        { planId },
      );
      return { data: versionDto(row) };
    });
  }
  async saveDraft(
    i: CustomerIdentity,
    etag: string | undefined,
    id: string,
    b: SaveLogisticsDraftDto,
  ) {
    this.require(i, permissions.logisticsEdit);
    const expected = parseEtag(etag);
    return this.txs.run(i, async (tx) => {
      const v = await this.version(tx, i, id);
      if (v.statusCode !== "DRAFT") conflict("LOGISTICS_VERSION_NOT_DRAFT");
      if (v.rowVersion !== expected) precondition();
      validateLines(b.lines);
      await tx.logisticsPlanLine.deleteMany({ where: { planVersionId: id } });
      await tx.logisticsTransportUnit.deleteMany({
        where: { planVersionId: id },
      });
      await tx.logisticsPlacement.deleteMany({
        where: { logisticsPlanVersionId: id },
      });
      await this.replaceLines(tx, id, b.lines);
      for (const unit of b.transportUnits ?? [{ instanceNo: 1 }])
        await tx.logisticsTransportUnit.create({
          data: {
            planVersionId: id,
            templateId: unit.templateId ?? null,
            instanceNo: unit.instanceNo,
            nameSnapshot: DEFAULT_UNIT.name,
            lengthMm: DEFAULT_UNIT.length,
            widthMm: DEFAULT_UNIT.width,
            heightMm: DEFAULT_UNIT.height,
            maxWeightKg: DEFAULT_UNIT.maxWeight,
          },
        });
      const input = {
        lines: b.lines,
        transportUnits: b.transportUnits ?? [
          { instanceNo: 1, profile: DEFAULT_UNIT },
        ],
      };
      const row = await tx.logisticsPlanVersion.update({
        where: { id },
        data: {
          inputSnapshot: json(input),
          sourceSnapshotHash: hash(input),
          completenessModeCode: b.completenessMode,
          derivedResultsStatusCode: "INVALIDATED",
          derivedResultsInvalidatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await tx.logisticsOptimizerRun.updateMany({
        where: { planVersionId: id, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      });
      await this.record(
        tx,
        i,
        "LOGISTICS_DRAFT_UPDATED",
        "LogisticsPlanVersion",
        id,
        { flatOnFace: true, rotations: [0, 90] },
      );
      return { data: versionDto(row), etag: etagOf(row.rowVersion) };
    });
  }
  async optimize(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: OptimizePlanDto,
  ) {
    this.require(i, permissions.logisticsOptimize);
    key = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const v = await this.version(tx, i, id);
      if (v.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      const requestHash = hash({ id, b }),
        replay = await this.replay(
          tx,
          i,
          "post_logistics_optimize",
          key,
          requestHash,
        );
      if (replay) {
        const r = await tx.logisticsOptimizerRun.findUniqueOrThrow({
          where: { id: replay },
        });
        return { data: runDto(r), etag: etagOf(v.rowVersion) };
      }
      const lines = await tx.logisticsPlanLine.findMany({
          where: { planVersionId: id },
          orderBy: { id: "asc" },
        }),
        units = await tx.logisticsTransportUnit.findMany({
          where: { planVersionId: id },
          orderBy: { instanceNo: "asc" },
        });
      if (!lines.length || !units.length) rule("LOGISTICS_INPUT_INCOMPLETE");
      const loadLines = lines.map((l) => ({
        id: l.id,
        qty: Number(l.qty),
        length: Number(l.lengthMm),
        width: Number(l.widthMm),
        thickness: Number(l.thicknessMm),
        weight: Number(l.weightKg ?? 0),
      }));
      const loadUnits = units.map((u) => ({
        id: u.id,
        length: Number(u.lengthMm),
        width: Number(u.widthMm),
        height: Number(u.heightMm),
        maxWeight: Number(u.maxWeightKg),
      }));
      const result = planFlatOnFace(loadLines, loadUnits),
        errors = validatePlacements(result.placements, loadUnits);
      if (errors.length) rule("LOGISTICS_OPTIMIZER_INVALID_RESULT");
      await tx.logisticsPlacement.deleteMany({
        where: { logisticsPlanVersionId: id },
      });
      for (const p of result.placements)
        await tx.logisticsPlacement.create({
          data: {
            logisticsPlanVersionId: id,
            demandSourceTypeCode: "PLAN_LINE",
            demandSourceId: p.lineId,
            planLineId: p.lineId,
            planTransportUnitId: p.unitId,
            x: p.x,
            y: p.y,
            z: p.z,
            length: p.length,
            width: p.width,
            height: p.height,
            rotationDeg: p.rotation,
            stackOrder: 0,
            stackQty: p.stackQty,
          },
        });
      const now = new Date(),
        run = await tx.logisticsOptimizerRun.create({
          data: {
            planVersionId: id,
            objectiveCode: b.objectiveCode ?? "MIN_VEHICLES",
            inputHash: v.sourceSnapshotHash ?? hash(v.inputSnapshot),
            planRowVersionSnapshot: v.rowVersion,
            inputSummary: json({
              lineCount: lines.length,
              unitCount: units.length,
            }),
            resultSummary: json({
              loadedQty: result.loaded,
              remainingQty: result.remaining,
              vehicleCount: units.length,
              flatOnFace: true,
            }),
            statusCode: "SUCCEEDED",
            startedAt: now,
            finishedAt: now,
            appliedAt: now,
            createdByUserId: i.userId,
          },
        });
      const updated = await tx.logisticsPlanVersion.update({
        where: { id },
        data: {
          statusCode: "DRAFT",
          derivedResultsStatusCode: "VALID",
          constraintsSnapshot: json({
            orientation: "FLAT_ON_FACE",
            rotations: [0, 90],
          }),
          rowVersion: { increment: 1 },
        },
      });
      await this.remember(
        tx,
        i,
        "post_logistics_optimize",
        key,
        requestHash,
        run.id,
      );
      await this.record(
        tx,
        i,
        "LOGISTICS_OPTIMIZED",
        "LogisticsOptimizerRun",
        run.id,
        { loaded: result.loaded, remaining: result.remaining },
      );
      return { data: runDto(run), etag: etagOf(updated.rowVersion) };
    });
  }
  async validate(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: ExpectedVersionDto,
  ) {
    this.require(i, permissions.logisticsValidate);
    key = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const v = await this.version(tx, i, id);
      if (v.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      const requestHash = hash({ id, b }),
        replay = await this.replay(
          tx,
          i,
          "post_logistics_validate",
          key,
          requestHash,
        );
      if (replay) {
        const rows = await tx.logisticsValidationResult.findMany({
          where: { planVersionId: id },
        });
        return { data: rows.map(validationDto), etag: etagOf(v.rowVersion) };
      }
      const lines = await tx.logisticsPlanLine.findMany({
          where: { planVersionId: id },
        }),
        units = await tx.logisticsTransportUnit.findMany({
          where: { planVersionId: id },
        }),
        placements = await tx.logisticsPlacement.findMany({
          where: { logisticsPlanVersionId: id },
        });
      const loadUnits = units.map((u) => ({
        id: u.id,
        length: Number(u.lengthMm),
        width: Number(u.widthMm),
        height: Number(u.heightMm),
        maxWeight: Number(u.maxWeightKg),
      }));
      const ps = placements
        .filter((p) => p.planLineId && p.planTransportUnitId)
        .map((p) => ({
          lineId: p.planLineId!,
          unitId: p.planTransportUnitId!,
          x: Number(p.x),
          y: Number(p.y),
          z: Number(p.z),
          length: Number(p.length),
          width: Number(p.width),
          height: Number(p.height),
          rotation: p.rotationDeg as 0 | 90,
          stackQty: Number(p.stackQty),
        }));
      const rules = validatePlacements(ps, loadUnits);
      if (lines.length === 0) rules.push("NO_PLAN_LINES");
      if (units.length === 0) rules.push("NO_TRANSPORT_UNITS");
      if (v.completenessModeCode === "COMPLETE" && ps.length === 0)
        rules.push("NO_PLACEMENTS");
      await tx.logisticsValidationResult.deleteMany({
        where: { planVersionId: id },
      });
      const rows = [];
      for (const code of [...new Set(rules)])
        rows.push(
          await tx.logisticsValidationResult.create({
            data: {
              planVersionId: id,
              ruleCode: code,
              severityCode: "BLOCKER",
              message: code.replaceAll("_", " "),
            },
          }),
        );
      if (!rows.length)
        rows.push(
          await tx.logisticsValidationResult.create({
            data: {
              planVersionId: id,
              ruleCode: "PLAN_VALID",
              severityCode: "INFO",
              message: "Planning scenario satisfies Flat-on-Face constraints.",
            },
          }),
        );
      const updated = await tx.logisticsPlanVersion.update({
        where: { id },
        data: {
          statusCode: rules.length ? "DRAFT" : "VALIDATED",
          rowVersion: { increment: 1 },
        },
      });
      await this.remember(
        tx,
        i,
        "post_logistics_validate",
        key,
        requestHash,
        id,
      );
      await this.record(
        tx,
        i,
        "LOGISTICS_VALIDATED",
        "LogisticsPlanVersion",
        id,
        { blockers: rules.length },
      );
      return {
        data: rows.map(validationDto),
        etag: etagOf(updated.rowVersion),
      };
    });
  }
  async visualization(i: CustomerIdentity, id: string) {
    this.require(i, permissions.logisticsView);
    await this.version(this.db, i, id);
    const units = await this.db.logisticsTransportUnit.findMany({
        where: { planVersionId: id },
        orderBy: { instanceNo: "asc" },
      }),
      lines = await this.db.logisticsPlanLine.findMany({
        where: { planVersionId: id },
      }),
      ps = await this.db.logisticsPlacement.findMany({
        where: { logisticsPlanVersionId: id },
        orderBy: [{ stackOrder: "asc" }, { id: "asc" }],
      });
    return {
      data: {
        planVersionId: id,
        transportUnits: units.map(unitDto),
        placements: ps
          .filter((p) => p.planLineId && p.planTransportUnitId)
          .map((p) => {
            const line = lines.find((item) => item.id === p.planLineId);
            return {
              placementId: p.id,
              planTransportUnitId: p.planTransportUnitId,
              planLineId: p.planLineId,
              xMm: p.x.toString(),
              yMm: p.y.toString(),
              zMm: p.z.toString(),
              lengthMm: p.length.toString(),
              widthMm: p.width.toString(),
              heightMm: p.height.toString(),
              rotationCode: String(p.rotationDeg),
              stackQty: p.stackQty.toString(),
              requestedQty: line?.qty.toString() ?? null,
              boardWeightKg: line?.weightKg?.toString() ?? null,
            };
          }),
      },
    };
  }
  async compare(i: CustomerIdentity, b: CompareLogisticsDto) {
    this.require(i, permissions.logisticsView);
    const versions = [];
    for (const id of b.planVersionIds) {
      await this.version(this.db, i, id);
      const [units, ps, validations, lines] = await Promise.all([
        this.db.logisticsTransportUnit.count({ where: { planVersionId: id } }),
        this.db.logisticsPlacement.findMany({
          where: { logisticsPlanVersionId: id },
        }),
        this.db.logisticsValidationResult.findMany({
          where: { planVersionId: id },
        }),
        this.db.logisticsPlanLine.findMany({ where: { planVersionId: id } }),
      ]);
      const loaded = ps.reduce((a, p) => a + Number(p.stackQty), 0),
        total = lines.reduce((a, l) => a + Number(l.qty), 0),
        weight = ps.reduce((a, p) => {
          const line = lines.find((l) => l.id === p.planLineId);
          return a + Number(line?.weightKg ?? 0) * Number(p.stackQty);
        }, 0);
      versions.push({
        planVersionId: id,
        vehicleCount: units,
        utilizationPct: null,
        loadedQty: String(loaded),
        remainingQty: String(Math.max(0, total - loaded)),
        totalWeightKg: String(weight),
        hardErrorCount: validations.filter((v) =>
          ["ERROR", "BLOCKER"].includes(v.severityCode),
        ).length,
        warningCount: validations.filter((v) => v.severityCode === "WARNING")
          .length,
      });
    }
    return { data: { versions } };
  }
  async optimizerRun(i: CustomerIdentity, id: string) {
    this.require(i, permissions.logisticsView);
    const row = await this.db.logisticsOptimizerRun.findUnique({
      where: { id },
    });
    if (!row) missing("OPTIMIZER_RUN_NOT_FOUND");
    await this.version(this.db, i, row.planVersionId);
    return { data: runDto(row) };
  }
  async exportPlan(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: CreateLogisticsExportDto,
  ) {
    this.require(i, permissions.logisticsExport);
    key = requireKey(key);
    return this.txs.run(i, async (tx) => {
      await this.version(tx, i, id);
      const requestHash = hash({ id, b }),
        replay = await this.replay(
          tx,
          i,
          "post_logistics_exports",
          key,
          requestHash,
        );
      if (replay) {
        const e = await tx.logisticsExport.findUniqueOrThrow({
          where: { id: replay },
        });
        return { data: exportDto(e) };
      }
      const e = await tx.logisticsExport.create({
        data: {
          planVersionId: id,
          userId: i.userId,
          formatCode: b.formatCode,
          includeValidation: b.includeValidation ?? false,
        },
      });
      const job = await this.jobs.enqueue(tx, {
        type: "LOGISTICS_EXPORT",
        payload: {
          exportEventId: e.id,
          planVersionId: id,
          formatCode: b.formatCode,
        },
        traceId: i.traceId,
        correlationId: i.correlationId,
        idempotencyKey: key,
        sourceType: "LogisticsExport",
        sourceId: e.id,
      });
      const updated = await tx.logisticsExport.update({
        where: { id: e.id },
        data: { jobId: job.jobId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "LOGISTICS_EXPORT_REQUESTED",
        aggregateType: "LogisticsExport",
        aggregateId: e.id,
        payload: { jobId: job.jobId, planVersionId: id },
        traceId: i.traceId,
        correlationId: i.correlationId,
        idempotencyKey: key,
      });
      await this.remember(
        tx,
        i,
        "post_logistics_exports",
        key,
        requestHash,
        e.id,
      );
      await this.record(
        tx,
        i,
        "LOGISTICS_EXPORT_REQUESTED",
        "LogisticsExport",
        e.id,
        { formatCode: b.formatCode, jobId: job.jobId },
      );
      return { data: exportDto(updated) };
    });
  }
  private async source(
    tx: TransactionClient,
    i: CustomerIdentity,
    b: CreateLogisticsPlanDto,
  ) {
    if (b.sourceTypeCode === "MANUAL_SCENARIO") {
      if (b.sourceResourceId || !b.countryCode)
        rule("MANUAL_LOGISTICS_SOURCE_INVALID");
      const code = b.countryCode.toUpperCase();
      if (!i.countryCodes.has(code)) forbidden();
      return { countryCode: code };
    }
    if (!b.sourceResourceId) rule("LOGISTICS_SOURCE_REQUIRED");
    if (b.sourceTypeCode === "QUOTATION") {
      const r = await tx.quotation.findFirst({
        where: {
          id: b.sourceResourceId,
          countryCode: { in: [...i.countryCodes] },
          ...(i.workspaces.has("SALES")
            ? { account: { OR: accountAccess(i) } }
            : {}),
        },
        select: { countryCode: true },
      });
      if (!r) missing("LOGISTICS_SOURCE_NOT_FOUND");
      return { countryCode: r.countryCode.trim() };
    }
    const r = await tx.eRPOrder.findFirst({
      where: {
        id: b.sourceResourceId,
        countryCode: { in: [...i.countryCodes] },
        ...(i.workspaces.has("SALES")
          ? { account: { OR: accountAccess(i) } }
          : {}),
      },
      select: { countryCode: true },
    });
    if (!r?.countryCode) missing("LOGISTICS_SOURCE_NOT_FOUND");
    return { countryCode: r.countryCode.trim() };
  }
  private plan(i: CustomerIdentity, id: string) {
    return this.planTx(this.db, i, id);
  }
  private async planTx(
    tx: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const r = await tx.logisticsPlan.findFirst({
      where: { id, countryCode: { in: [...i.countryCodes] } },
    });
    if (!r) missing("LOGISTICS_PLAN_NOT_FOUND");
    return r;
  }
  private async version(
    tx: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const r = await tx.logisticsPlanVersion.findUnique({ where: { id } });
    if (!r) missing("LOGISTICS_VERSION_NOT_FOUND");
    await this.planTx(tx, i, r.logisticsPlanId);
    return r;
  }
  private async replaceLines(
    tx: TransactionClient,
    id: string,
    lines: SaveLogisticsDraftDto["lines"],
  ) {
    validateLines(lines);
    for (const l of lines)
      await tx.logisticsPlanLine.create({
        data: {
          ...(l.planLineId ? { id: l.planLineId } : {}),
          planVersionId: id,
          productId: l.productId ?? null,
          qty: l.qty,
          lengthMm: l.lengthMm,
          widthMm: l.widthMm,
          thicknessMm: l.thicknessMm,
          weightKg: l.weightKg ?? null,
          orientationCode: l.orientationCode,
        },
      });
  }
  private require(i: CustomerIdentity, p: string) {
    if (
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p) ||
      (!hasWorkspace(i, "LOGISTICS") && !hasWorkspace(i, "SALES"))
    )
      forbidden();
  }
  private replay(
    tx: TransactionClient,
    i: CustomerIdentity,
    op: string,
    key: string,
    requestHash: string,
  ) {
    return tx.commandIdempotency
      .findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: op,
            idempotencyKey: key,
          },
        },
      })
      .then((r) => {
        if (r && r.requestHash !== requestHash)
          conflict("IDEMPOTENCY_KEY_REUSED");
        return r?.responseResourceId;
      });
  }
  private remember(
    tx: TransactionClient,
    i: CustomerIdentity,
    op: string,
    key: string,
    requestHash: string,
    id: string,
  ) {
    return tx.commandIdempotency.create({
      data: {
        actorUserId: i.userId,
        operationCode: op,
        idempotencyKey: key,
        requestHash,
        responseResourceId: id,
      },
    });
  }
  private record(
    tx: TransactionClient,
    i: CustomerIdentity,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode,
      resourceType,
      resourceId,
      workspace: i.workspaces.has("LOGISTICS") ? "LOGISTICS" : "SALES",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "logistics-api",
    });
  }
}
function validateLines(lines: SaveLogisticsDraftDto["lines"]) {
  for (const l of lines) {
    for (const n of [l.qty, l.lengthMm, l.widthMm, l.thicknessMm])
      if (!new Prisma.Decimal(n).isPositive())
        rule("LOGISTICS_DIMENSION_OR_QTY_INVALID");
    if (l.orientationCode !== "FLAT_ON_FACE")
      rule("LOGISTICS_ORIENTATION_NOT_ALLOWED");
  }
}
function planDto(r: Prisma.LogisticsPlanGetPayload<object>) {
  return {
    logisticsPlanId: r.id,
    planRef: r.planRef,
    sourceTypeCode: r.sourceTypeCode,
    sourceResourceId: r.sourceId,
    countryCode: r.countryCode.trim(),
    ownerUserId: r.createdByUserId,
    statusCode: r.statusCode,
    selectedVersionId: r.selectedVersionId,
  };
}
function versionDto(r: Prisma.LogisticsPlanVersionGetPayload<object>) {
  return {
    planVersionId: r.id,
    logisticsPlanId: r.logisticsPlanId,
    versionNo: r.versionNo,
    statusCode: r.statusCode,
    sourceSnapshotHash: r.sourceSnapshotHash,
    inputSnapshotJsonb: r.inputSnapshot,
    constraintsSnapshotJsonb: r.constraintsSnapshot,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
    rowVersion: r.rowVersion.toString(),
    completenessModeCode: r.completenessModeCode,
    derivedResultsStatusCode: r.derivedResultsStatusCode,
    derivedResultsInvalidatedAt:
      r.derivedResultsInvalidatedAt?.toISOString() ?? null,
  };
}
function runDto(r: Prisma.LogisticsOptimizerRunGetPayload<object>) {
  return {
    optimizerRunId: r.id,
    planVersionId: r.planVersionId,
    algorithmCode: r.algorithmCode,
    algorithmVersion: r.algorithmVersion,
    objectiveCode: r.objectiveCode,
    constraintsHash: r.constraintsHash,
    inputSummaryJsonb: r.inputSummary,
    resultSummaryJsonb: r.resultSummary,
    statusCode: r.statusCode,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    errorCode: r.errorCode,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
    inputHash: r.inputHash,
    planRowVersionSnapshot: Number(r.planRowVersionSnapshot),
    invalidatedAt: r.invalidatedAt?.toISOString() ?? null,
    appliedAt: r.appliedAt?.toISOString() ?? null,
    statusUrl: `/api/v1/logistics/optimizer-runs/${r.id}`,
  };
}
function validationDto(r: Prisma.LogisticsValidationResultGetPayload<object>) {
  return {
    validationResultId: r.id,
    planVersionId: r.planVersionId,
    ruleCode: r.ruleCode,
    severityCode: r.severityCode,
    message: r.message,
    contextJsonb: r.context,
    createdAt: r.createdAt.toISOString(),
  };
}
function unitDto(u: Prisma.LogisticsTransportUnitGetPayload<object>) {
  return {
    planTransportUnitId: u.id,
    planVersionId: u.planVersionId,
    templateId: u.templateId,
    instanceNo: u.instanceNo,
    nameSnapshot: u.nameSnapshot,
    lengthMmSnapshot: u.lengthMm.toString(),
    widthMmSnapshot: u.widthMm.toString(),
    heightMmSnapshot: u.heightMm.toString(),
    maxWeightKgSnapshot: u.maxWeightKg.toString(),
    createdAt: u.createdAt.toISOString(),
  };
}
function exportDto(e: Prisma.LogisticsExportGetPayload<object>) {
  return {
    exportEventId: e.id,
    userId: e.userId,
    exportTypeCode: e.formatCode,
    resourceTypeCode: "LOGISTICS_PLAN_VERSION",
    filterSummaryJsonb: {
      planVersionId: e.planVersionId,
      includeValidation: e.includeValidation,
    },
    rowCount: null,
    documentId: null,
    statusCode: e.statusCode,
    failureCode: e.failureCode,
    createdAt: e.createdAt.toISOString(),
    completedAt: e.completedAt?.toISOString() ?? null,
    statusUrl: `/api/v1/jobs/${e.jobId}`,
  };
}
function accountAccess(i: CustomerIdentity): Prisma.AccountWhereInput[] {
  return [
    { ownerUserId: i.userId },
    {
      shares: {
        some: {
          recipientUserId: i.userId,
          statusCode: "ACTIVE",
          accessLevelCode: { in: ["VIEW", "COLLABORATE_EDIT"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
    },
  ];
}
function json(v: unknown) {
  return v as Prisma.InputJsonValue;
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function requireKey(k: string | undefined) {
  if (!k || k.length < 8 || k.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  return k;
}
function parseEtag(v: string | undefined) {
  const m = v?.match(/^(?:W\/)?"(\d+)"$/);
  if (!m) throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  return BigInt(m[1]!);
}
function etagOf(v: bigint) {
  return `"${v}"`;
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function forbidden(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
function conflict(code: string): never {
  throw new ApiProblem({ status: 409, code });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "ROW_VERSION_MISMATCH" });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
