import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
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
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type {
  CapacityEstimateDto,
  CapacityListQuery,
  CapacityRateResolveQuery,
  CreateCapacityRateDto,
} from "./capacity.dto.js";
import { calculateCapacity } from "./capacity-calculator.js";

const lockedRates: Record<string, string> = {
  STANDARD: "900",
  ORDINARY: "700",
  CURVED: "600",
};
@Injectable()
export class CapacityService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}
  async createEstimate(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CapacityEstimateDto,
  ) {
    this.require(identity, permissions.capacityEstimate);
    key = requireKey(key);
    validateEstimateInput(input);
    const requestHash = hash({ input });
    return this.txs.run(identity, async (tx) => {
      const replay = await this.replay(
        tx,
        identity,
        "post_capacity_estimates",
        key,
        requestHash,
      );
      if (replay) return { data: await estimateDto(tx, replay) };
      const source = await this.requireSource(
        tx,
        identity,
        input.sourceTypeCode,
        input.sourceResourceId ?? null,
      );
      const startAt = input.startAt ? new Date(input.startAt) : null;
      const effectiveAt = startAt ?? new Date();
      const categories = [
        ...new Set(input.items.map((item) => item.categoryCode)),
      ];
      const rates = await tx.capacityRate.findMany({
        where: {
          categoryCode: { in: categories },
          statusCode: "ACTIVE",
          effectiveFrom: { lte: effectiveAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveAt } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      const byCategory = new Map<string, (typeof rates)[number]>();
      for (const rate of rates)
        if (!byCategory.has(rate.categoryCode))
          byCategory.set(rate.categoryCode, rate);
      if (categories.some((c) => !byCategory.has(c)))
        missing("CAPACITY_RATE_NOT_FOUND");
      const calculated = input.items.map((item) => {
        const rate = byCategory.get(item.categoryCode);
        if (!rate) missing("CAPACITY_RATE_NOT_FOUND");
        const qty = new Prisma.Decimal(item.quantityBoards);
        if (!qty.isPositive()) rule("CAPACITY_QUANTITY_MUST_BE_POSITIVE");
        const { days, hours } = calculateCapacity(qty, rate.boardsPerDay);
        return {
          item,
          rate,
          qty,
          days,
          hours,
          finish: startAt
            ? new Date(startAt.getTime() + hours.toNumber() * 3_600_000)
            : null,
        };
      });
      const run = await tx.capacityEstimateRun.create({
        data: {
          sourceTypeCode: input.sourceTypeCode,
          sourceResourceId: input.sourceResourceId ?? null,
          countryCode: source.countryCode,
          startAt,
          estimatedFinishAt:
            calculated.length === 1 ? (calculated[0]?.finish ?? null) : null,
          createdByUserId: identity.userId,
        },
      });
      for (const value of calculated)
        await tx.capacityEstimate.create({
          data: {
            estimateRunId: run.id,
            sourceTypeCode: input.sourceTypeCode,
            sourceId: input.sourceResourceId ?? null,
            categoryCode: value.item.categoryCode,
            requestedBoards: value.qty,
            estimatedDays: value.days,
            rateBoardsPerDaySnapshot: value.rate.boardsPerDay,
            durationHours: value.hours,
            estimatedFinishAt: value.finish,
            capacityRateId: value.rate.id,
          },
        });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "post_capacity_estimates",
          idempotencyKey: key,
          requestHash,
          responseResourceId: run.id,
        },
      });
      await this.record(
        tx,
        identity,
        "CAPACITY_ESTIMATE_CREATED",
        "CapacityEstimate",
        run.id,
        {
          sourceTypeCode: run.sourceTypeCode,
          sourceResourceId: run.sourceResourceId,
          categories,
          estimateOnly: true,
        },
      );
      return { data: await estimateDto(tx, run.id) };
    });
  }
  async listEstimates(identity: CustomerIdentity, query: CapacityListQuery) {
    this.require(identity, permissions.capacityView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.CapacityEstimateRunWhereInput = {
      OR: [
        { countryCode: { in: [...identity.countryCodes] } },
        { countryCode: null, createdByUserId: identity.userId },
      ],
      ...(query.search
        ? {
            sourceTypeCode: {
              contains: query.search.trim(),
              mode: "insensitive",
            },
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.capacityEstimateRun.count({ where }),
      this.db.capacityEstimateRun.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: await Promise.all(rows.map((r) => estimateDto(this.db, r.id))),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }
  async getEstimate(identity: CustomerIdentity, id: string) {
    this.require(identity, permissions.capacityView);
    const row = await this.db.capacityEstimateRun.findFirst({
      where: {
        id,
        OR: [
          { countryCode: { in: [...identity.countryCodes] } },
          { countryCode: null, createdByUserId: identity.userId },
        ],
      },
    });
    if (!row) missing("CAPACITY_ESTIMATE_NOT_FOUND");
    return { data: await estimateDto(this.db, id) };
  }
  async listRates(identity: CustomerIdentity, query: CapacityListQuery) {
    this.require(identity, permissions.capacityView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.CapacityRateWhereInput = query.search
      ? {
          OR: [
            {
              categoryCode: {
                contains: query.search.trim(),
                mode: "insensitive",
              },
            },
            {
              sourceCode: {
                contains: query.search.trim(),
                mode: "insensitive",
              },
            },
          ],
        }
      : {};
    const [total, rows] = await this.db.$transaction([
      this.db.capacityRate.count({ where }),
      this.db.capacityRate.findMany({
        where,
        orderBy: [{ categoryCode: "asc" }, { effectiveFrom: "desc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: rows.map(rateDto),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }
  async resolveRate(
    identity: CustomerIdentity,
    query: CapacityRateResolveQuery,
  ) {
    this.require(identity, permissions.capacityView);
    const at = query.effectiveAt ? new Date(query.effectiveAt) : new Date();
    const row = await this.db.capacityRate.findFirst({
      where: {
        categoryCode: query.categoryCode,
        statusCode: "ACTIVE",
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!row) missing("CAPACITY_RATE_NOT_FOUND");
    return { data: rateDto(row) };
  }
  async createRate(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateCapacityRateDto,
  ) {
    this.requireManage(identity);
    key = requireKey(key);
    if (
      lockedRates[input.categoryCode] !==
      new Prisma.Decimal(input.boardsPerDay).toString()
    )
      rule("CAPACITY_RATE_LOCKED_VALUE");
    const from = new Date(input.effectiveFrom),
      to = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (from <= new Date()) rule("CAPACITY_RATE_MUST_BE_FUTURE");
    if (to && to <= from) rule("CAPACITY_RATE_RANGE_INVALID");
    const requestHash = hash(input);
    return this.txs.run(
      identity,
      async (tx) => {
        const replay = await this.replay(
          tx,
          identity,
          "post_capacity_rates",
          key,
          requestHash,
        );
        if (replay) {
          const row = await tx.capacityRate.findUnique({
            where: { id: replay },
          });
          if (!row) conflict("IDEMPOTENCY_REPLAY_MISSING");
          return { data: rateDto(row) };
        }
        const current = await tx.capacityRate.findFirst({
          where: {
            categoryCode: input.categoryCode,
            statusCode: "ACTIVE",
            effectiveFrom: { lt: from },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
          },
          orderBy: { effectiveFrom: "desc" },
        });
        if (current)
          await tx.capacityRate.update({
            where: { id: current.id },
            data: { effectiveTo: from },
          });
        const overlap = await tx.capacityRate.count({
          where: {
            categoryCode: input.categoryCode,
            statusCode: "ACTIVE",
            effectiveFrom: { lt: to ?? new Date("9999-12-31") },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
          },
        });
        if (overlap) conflict("CAPACITY_RATE_EFFECTIVE_RANGE_OVERLAP");
        const version =
          (
            await tx.capacityRate.aggregate({
              where: { categoryCode: input.categoryCode },
              _max: { version: true },
            })
          )._max.version ?? 0;
        const row = await tx.capacityRate.create({
          data: {
            categoryCode: input.categoryCode,
            boardsPerDay: Number(input.boardsPerDay),
            hoursPerDay: 24,
            effectiveFrom: from,
            effectiveTo: to,
            version: version + 1,
            sourceCode: input.sourceCode,
            changedByUserId: identity.userId,
          },
        });
        await tx.commandIdempotency.create({
          data: {
            actorUserId: identity.userId,
            operationCode: "post_capacity_rates",
            idempotencyKey: key,
            requestHash,
            responseResourceId: row.id,
          },
        });
        await this.record(
          tx,
          identity,
          "CAPACITY_RATE_VERSION_CREATED",
          "CapacityRate",
          row.id,
          {
            categoryCode: row.categoryCode,
            boardsPerDay: row.boardsPerDay,
            effectiveFrom: row.effectiveFrom.toISOString(),
          },
        );
        return { data: rateDto(row) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  private async requireSource(
    tx: TransactionClient,
    identity: CustomerIdentity,
    type: string,
    id: string | null,
  ) {
    if (type === "MANUAL") {
      if (id) rule("MANUAL_CAPACITY_SOURCE_MUST_BE_NULL");
      return { countryCode: null };
    }
    if (!id) rule("CAPACITY_SOURCE_REQUIRED");
    if (type === "QUOTATION") {
      const row = await tx.quotation.findFirst({
        where: {
          id,
          countryCode: { in: [...identity.countryCodes] },
          ...(identity.workspaces.has("SALES")
            ? { account: { OR: accountAccess(identity) } }
            : {}),
        },
        select: { countryCode: true },
      });
      if (!row) missing("CAPACITY_SOURCE_NOT_FOUND");
      return { countryCode: row.countryCode.trim() };
    }
    const row = await tx.eRPOrder.findFirst({
      where: {
        id,
        countryCode: { in: [...identity.countryCodes] },
        ...(identity.workspaces.has("SALES")
          ? { account: { OR: accountAccess(identity) } }
          : {}),
      },
      select: { countryCode: true },
    });
    if (!row) missing("CAPACITY_SOURCE_NOT_FOUND");
    return { countryCode: row.countryCode?.trim() ?? null };
  }
  private require(identity: CustomerIdentity, permission: string) {
    if (
      identity.deniedPermissions.has(permission) ||
      !identity.permissions.has(permission) ||
      !["SALES", "OPERATIONS"].some((workspace) =>
        hasWorkspace(identity, workspace),
      )
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
  private requireManage(identity: CustomerIdentity) {
    if (
      !hasWorkspace(identity, "OPERATIONS") ||
      identity.deniedPermissions.has(permissions.capacityManage) ||
      !identity.permissions.has(permissions.capacityManage)
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
  private replay(
    tx: Pick<DatabaseClient, "commandIdempotency">,
    identity: CustomerIdentity,
    operation: string,
    key: string,
    requestHash: string,
  ) {
    return tx.commandIdempotency
      .findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: identity.userId,
            operationCode: operation,
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
  private record(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType,
      resourceId,
      workspace: identity.workspaces.has("OPERATIONS") ? "OPERATIONS" : "SALES",
      countryCode: null,
      metadata,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "capacity-api",
    });
  }
}
async function estimateDto(
  db:
    | Pick<DatabaseClient, "capacityEstimateRun" | "capacityEstimate">
    | TransactionClient,
  id: string,
) {
  const run = await db.capacityEstimateRun.findUnique({ where: { id } });
  if (!run) missing("CAPACITY_ESTIMATE_NOT_FOUND");
  const items = await db.capacityEstimate.findMany({
    where: { estimateRunId: id },
    orderBy: [{ categoryCode: "asc" }, { id: "asc" }],
  });
  return {
    capacityEstimateId: run.id,
    sourceTypeCode: run.sourceTypeCode,
    sourceResourceId: run.sourceResourceId,
    startAt: run.startAt?.toISOString() ?? null,
    estimatedFinishAt: run.estimatedFinishAt?.toISOString() ?? null,
    items: items.map((i) => ({
      categoryCode: i.categoryCode,
      quantityBoards: i.requestedBoards.toString(),
      rateBoardsPerDaySnapshot: i.rateBoardsPerDaySnapshot.toString(),
      requiredDaysDecimal: i.estimatedDays.toString(),
      durationHours: i.durationHours.toString(),
      estimatedFinishAt: i.estimatedFinishAt?.toISOString() ?? null,
    })),
    createdAt: run.createdAt.toISOString(),
  };
}
function rateDto(r: Prisma.CapacityRateGetPayload<object>) {
  return {
    capacityRateId: r.id,
    categoryCode: r.categoryCode,
    boardsPerDay: r.boardsPerDay.toString(),
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo?.toISOString() ?? null,
    sourceCode: r.sourceCode,
    changedByUserId: r.changedByUserId,
  };
}
function accountAccess(identity: CustomerIdentity): Prisma.AccountWhereInput[] {
  return [
    { ownerUserId: identity.userId },
    {
      shares: {
        some: {
          recipientUserId: identity.userId,
          statusCode: "ACTIVE",
          accessLevelCode: { in: ["VIEW", "COLLABORATE_EDIT"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
    },
  ];
}
function validateEstimateInput(input: CapacityEstimateDto) {
  if (input.items.length > 3) rule("CAPACITY_CATEGORY_DUPLICATE");
  if (
    new Set(input.items.map((i) => i.categoryCode)).size !== input.items.length
  )
    rule("CAPACITY_CATEGORY_DUPLICATE");
  if ((input.sourceTypeCode === "MANUAL") !== (input.sourceResourceId == null))
    rule("CAPACITY_SOURCE_INVALID");
}
function requireKey(key: string | undefined) {
  if (!key || key.length < 8 || key.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  return key;
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function conflict(code: string): never {
  throw new ApiProblem({ status: 409, code });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
