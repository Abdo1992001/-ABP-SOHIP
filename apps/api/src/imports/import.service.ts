/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unnecessary-type-assertion, no-useless-escape */
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
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { importTypeRule, naturalKeyFor, validateRow } from "./import-rules.js";
import { AuditService } from "../platform/audit.service.js";
import { DurableJobsService } from "../platform/durable-jobs.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { OutboxService } from "../platform/outbox.service.js";
import type {
  CommitImportDto,
  CreateImportJobDto,
  CreateItemMappingDto,
  CreateReconciliationRunDto,
  DataQualityListQuery,
  ImportListQuery,
  ReconciliationListQuery,
  ResolveIssueDto,
  ResolveItemDto,
  ResolveReconciliationIssueDto,
  RetryImportDto,
  RollbackImportDto,
  ValidateImportDto,
} from "./import.dto.js";
import { ImportFileProblem, parseImportFile } from "./safe-import-parser.js";

@Injectable()
export class ImportService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly jobs: DurableJobsService,
  ) {}

  async create(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateImportJobDto,
  ) {
    this.require(identity, permissions.importsManage);
    requireKey(key);
    validateFileMetadata(input);
    const requestHash = hashJson(input);
    return this.txs.run(identity, async (tx) => {
      const replay = await this.replay(
        tx,
        identity,
        "post_import_jobs",
        key!,
        requestHash,
      );
      if (replay) return { data: importDto(await requiredBatch(tx, replay)) };
      const ext = extensionOf(input.fileName);
      const row = await tx.importBatch.create({
        data: {
          sourceSystemCode: input.sourceSystemCode,
          sourceSystemId: stableUuid(`source-system:${input.sourceSystemCode}`),
          importTypeCode: input.importTypeCode,
          fileName: safeName(input.fileName),
          safeStorageKey: `${randomUUID()}${ext}`,
          expectedSizeBytes: BigInt(input.expectedSizeBytes),
          mimeType: input.mimeType.toLowerCase(),
          sourceFingerprint: requestHash,
          actorUserId: identity.userId,
          statusCode: "UPLOADED",
        },
      });
      await this.remember(
        tx,
        identity,
        "post_import_jobs",
        key!,
        requestHash,
        row.id,
      );
      await this.record(
        tx,
        identity,
        "IMPORT_INTAKE_REGISTERED",
        "ImportJob",
        row.id,
        {
          importTypeCode: row.importTypeCode,
          expectedSizeBytes: input.expectedSizeBytes,
        },
      );
      return { data: importDto(row) };
    });
  }

  async list(identity: CustomerIdentity, query: ImportListQuery) {
    this.require(identity, permissions.importsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.ImportBatchWhereInput = {
      // An import run by a data engineer is still the company's import. Scoping
      // the list to the caller made every job invisible to the administrator
      // reviewing it, which is the person most likely to be looking.
      ...(isSystemAdmin(identity) ? {} : { actorUserId: identity.userId }),
      ...(query.search
        ? {
            OR: [
              {
                fileName: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                importTypeCode: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                sourceSystemCode: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.importBatch.count({ where }),
      this.db.importBatch.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return listEnvelope(rows.map(importDto), offset, query.limit, total);
  }
  async get(identity: CustomerIdentity, id: string) {
    this.require(identity, permissions.importsView);
    return { data: importDto(await this.ownedBatch(identity, id)) };
  }
  async rows(identity: CustomerIdentity, id: string, query: ImportListQuery) {
    this.require(identity, permissions.importsView);
    await this.ownedBatch(identity, id);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.ImportRowWhereInput = {
      importBatchId: id,
      ...(query.search
        ? {
            OR: [
              {
                sourceRowKey: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                naturalKey: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.importRow.count({ where }),
      this.db.importRow.findMany({
        where,
        orderBy: [{ rowNo: "asc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return listEnvelope(
      rows.map((row) => ({
        rowNo: Number(row.rowNo),
        naturalKey: row.naturalKey,
        statusCode: row.statusCode,
        issueCount: row.issueCount,
        normalizedFields: jsonObject(row.normalizedPayload),
      })),
      offset,
      query.limit,
      total,
    );
  }
  async issues(identity: CustomerIdentity, id: string, query: ImportListQuery) {
    this.require(identity, permissions.dataQualityView);
    await this.ownedBatch(identity, id);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.DQIssueWhereInput = {
      importBatchId: id,
      ...(query.search
        ? {
            OR: [
              {
                ruleCode: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                message: { contains: query.search.trim(), mode: "insensitive" },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.dQIssue.count({ where }),
      this.db.dQIssue.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return listEnvelope(rows.map(dqDto), offset, query.limit, total);
  }

  async globalIssues(identity: CustomerIdentity, query: DataQualityListQuery) {
    this.require(identity, permissions.dataQualityView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const owned = await this.db.importBatch.findMany({
      where: isSystemAdmin(identity) ? {} : { actorUserId: identity.userId },
      select: { id: true },
    });
    const where: Prisma.DQIssueWhereInput = {
      AND: [
        {
          OR: [
            { importBatchId: { in: owned.map((x) => x.id) } },
            { importBatchId: null },
          ],
        },
        ...(query.search
          ? [
              {
                OR: [
                  {
                    ruleCode: {
                      contains: query.search.trim(),
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    message: {
                      contains: query.search.trim(),
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    sourceRecordKey: {
                      contains: query.search.trim(),
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
      ...(query.importJobId ? { importBatchId: query.importJobId } : {}),
      ...(query.statusCode ? { statusCode: query.statusCode } : {}),
      ...(query.severityCode ? { severityCode: query.severityCode } : {}),
      ...(query.issueCode ? { ruleCode: query.issueCode } : {}),
      ...(query.sourceEntityCode
        ? { sourceEntityCode: query.sourceEntityCode }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.dQIssue.count({ where }),
      this.db.dQIssue.findMany({
        where,
        orderBy: [
          { severityCode: "desc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return listEnvelope(rows.map(dqDetailDto), offset, query.limit, total);
  }

  async validate(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: ValidateImportDto,
  ) {
    this.require(identity, permissions.importsManage);
    requireKey(key);
    return this.command(
      identity,
      id,
      key!,
      "post_import_jobs_by_jobId_validate",
      input,
      ["UPLOADED", "FAILED"],
      "VALIDATING",
      "IMPORT_VALIDATE",
      "IMPORT_VALIDATION_REQUESTED",
    );
  }
  async commit(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: CommitImportDto,
  ) {
    this.require(identity, permissions.importsCommit);
    requireKey(key);
    const requestHash = hashJson({ id, input });
    const prior = await this.db.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "post_import_jobs_by_jobId_commit",
          idempotencyKey: key!,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== requestHash) conflict("IDEMPOTENCY_KEY_REUSED");
      return {
        data: importDto(await requiredBatch(this.db, prior.responseResourceId)),
      };
    }
    const batch = await this.ownedBatch(identity, id);
    if (batch.statusCode !== "PREVIEWED") rule("IMPORT_NOT_PREVIEWED");
    if (batch.currentPreviewFingerprint !== input.previewFingerprint)
      conflict("IMPORT_PREVIEW_FINGERPRINT_MISMATCH");
    const blockers = await this.db.dQIssue.count({
      where: {
        importBatchId: id,
        statusCode: "OPEN",
        OR: [
          { severityCode: { in: ["ERROR", "BLOCKER"] } },
          { ruleCode: "DATA_CONFLICT" },
        ],
      },
    });
    if (blockers > 0) rule("IMPORT_DQ_BLOCKERS_OPEN");
    return this.command(
      identity,
      id,
      key!,
      "post_import_jobs_by_jobId_commit",
      input,
      ["PREVIEWED"],
      "COMMIT_REQUESTED",
      "IMPORT_COMMIT",
      "IMPORT_COMMIT_REQUESTED",
    );
  }
  async retry(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: RetryImportDto,
  ) {
    this.require(identity, permissions.importsManage);
    requireKey(key);
    const next =
      input.stageCode === "VALIDATE"
        ? "VALIDATING"
        : input.stageCode === "COMMIT"
          ? "COMMIT_REQUESTED"
          : "ROLLBACK_REQUESTED";
    return this.command(
      identity,
      id,
      key!,
      "post_import_jobs_by_jobId_retry",
      input,
      ["FAILED"],
      next,
      `IMPORT_${input.stageCode}`,
      "IMPORT_RETRY_REQUESTED",
    );
  }
  async rollback(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: RollbackImportDto,
  ) {
    this.require(identity, permissions.importsRollback);
    requireKey(key);
    return this.command(
      identity,
      id,
      key!,
      "post_import_jobs_by_jobId_rollback",
      input,
      ["COMMITTED"],
      "ROLLBACK_REQUESTED",
      "IMPORT_ROLLBACK",
      "IMPORT_ROLLBACK_REQUESTED",
    );
  }

  /** Storage adapters call this after malware scanning; it never trusts the original path. */
  async ingestBuffer(
    identity: CustomerIdentity,
    id: string,
    file: Buffer,
    parserVersion: string,
    mappingVersion: string,
  ) {
    this.require(identity, permissions.importsManage);
    const batch = await this.ownedBatch(identity, id);
    if (!batch.fileName || !batch.mimeType)
      rule("IMPORT_FILE_METADATA_MISSING");
    if (
      batch.expectedSizeBytes !== null &&
      batch.expectedSizeBytes !== BigInt(file.length)
    )
      rule("IMPORT_FILE_SIZE_MISMATCH");
    let parsed;
    try {
      parsed = await parseImportFile(batch.fileName, batch.mimeType, file);
    } catch (error) {
      if (error instanceof ImportFileProblem)
        throw new ApiProblem({ status: 422, code: error.code });
      throw error;
    }
    // A file may only carry countries the importer is allowed to see. This
    // was checked for sales orders alone; a customer file carries countries
    // just as directly, and could previously name any of them. The rule table
    // says which types are scoped, so a new one cannot forget.
    if (importTypeRule(batch.importTypeCode)?.countryScoped === true) {
      for (const row of parsed.rows) {
        const countryCode = row.countryCode;
        if (
          typeof countryCode === "string" &&
          countryCode.trim().length > 0 &&
          !identity.countryCodes.has(countryCode.trim().toUpperCase())
        )
          throw new ApiProblem({ status: 403, code: "COUNTRY_SCOPE_DENIED" });
      }
    }
    const previewFingerprint = hashJson({
      fileSha256: parsed.fileSha256,
      schemaFingerprint: parsed.schemaFingerprint,
      parserVersion,
      mappingVersion,
    });
    const suppliedSegmentCodes = [
      ...new Set(
        parsed.rows
          .map((row) => row.customerSegmentCode)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
          .map((value) => value.trim().toUpperCase()),
      ),
    ];
    const knownSegmentCodes = new Set(
      (
        await this.db.customerSegmentDefinition.findMany({
          where: {
            code: { in: suppliedSegmentCodes },
            statusCode: "ACTIVE",
          },
          select: { code: true },
        })
      ).map((row) => row.code),
    );
    return this.txs.run(identity, async (tx) => {
      const duplicate = await tx.importBatch.findFirst({
        where: {
          fileSha256: parsed.fileSha256,
          importTypeCode: batch.importTypeCode,
          id: { not: id },
          statusCode: { not: "ROLLED_BACK" },
        },
      });
      if (duplicate) conflict("DUPLICATE_IMPORT_FILE");
      await tx.dQIssue.deleteMany({
        where: { importBatchId: id, statusCode: "OPEN" },
      });
      await tx.importRow.deleteMany({ where: { importBatchId: id } });
      let issueTotal = 0;
      for (const [index, values] of parsed.rows.entries()) {
        const rowNo = index + 2;
        const naturalKey = naturalKeyFor(batch.importTypeCode, values);
        const problems = validateRow(batch.importTypeCode, values);
        const suppliedSegmentCode =
          typeof values.customerSegmentCode === "string"
            ? values.customerSegmentCode.trim().toUpperCase()
            : "";
        if (suppliedSegmentCode && !knownSegmentCodes.has(suppliedSegmentCode))
          problems.push({
            code: "UNKNOWN_CUSTOMER_SEGMENT",
            severity: "ERROR",
            message:
              "Customer segment code is not an active governed definition; review is required.",
          });
        const row = await tx.importRow.create({
          data: {
            importBatchId: id,
            sourceRowKey: naturalKey ?? `ROW-${rowNo}`,
            sourceEntityCode: batch.importTypeCode,
            rowNo: BigInt(rowNo),
            naturalKey,
            rawPayload: values as Prisma.InputJsonValue,
            normalizedPayload: normalizeRecord(values) as Prisma.InputJsonValue,
            payloadHash: hashJson(values),
            statusCode: problems.length ? "INVALID" : "VALID",
            issueCount: problems.length,
          },
        });
        for (const problem of problems)
          await tx.dQIssue.create({
            data: {
              importBatchId: id,
              importRowId: row.id,
              sourceEntityCode: batch.importTypeCode,
              sourceRecordKey: row.sourceRowKey,
              ruleCode: problem.code,
              severityCode: problem.severity,
              message: problem.message,
            },
          });
        issueTotal += problems.length;
      }
      const updated = await tx.importBatch.update({
        where: { id },
        data: {
          fileSha256: parsed.fileSha256,
          schemaFingerprint: parsed.schemaFingerprint,
          statusCode: "PREVIEWED",
          previewedAt: new Date(),
          currentPreviewAttemptId: randomUUID(),
          currentPreviewFingerprint: previewFingerprint,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        identity,
        "IMPORT_PREVIEW_CREATED",
        "ImportJob",
        id,
        {
          rows: parsed.rows.length,
          columns: parsed.headers.length,
          issues: issueTotal,
          parserVersion,
          mappingVersion,
        },
      );
      return { data: importDto(updated) };
    });
  }

  async resolveIssue(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    ifMatch: string | undefined,
    input: ResolveIssueDto,
  ) {
    this.require(identity, permissions.dataQualityManage);
    requireKey(key);
    const expected = etagVersion(ifMatch);
    const requestHash = hashJson({ id, input });
    const prior = await this.replay(
      this.db,
      identity,
      "post_data_quality_issues_by_issueId_resolve",
      key!,
      requestHash,
    );
    if (prior) {
      const replay = await this.db.dQIssue.findUnique({ where: { id: prior } });
      if (!replay) missing("DQ_ISSUE_NOT_FOUND");
      return {
        data: dqDto(replay),
        etag: `"rv-${replay.rowVersion.toString()}"`,
      };
    }
    return this.txs.run(identity, async (tx) => {
      const old = await tx.dQIssue.findUnique({ where: { id } });
      if (!old) missing("DQ_ISSUE_NOT_FOUND");
      if (old.importBatchId && !isSystemAdmin(identity)) {
        const batch = await requiredBatch(tx, old.importBatchId);
        if (batch.actorUserId !== identity.userId)
          missing("DQ_ISSUE_NOT_FOUND");
      }
      if (old.statusCode !== "OPEN") conflict("DQ_ISSUE_ALREADY_RESOLVED");
      const updated = await tx.dQIssue.updateMany({
        where: { id, rowVersion: expected },
        data: {
          statusCode: input.resolutionCode === "WAIVE" ? "WAIVED" : "RESOLVED",
          resolutionCode: input.resolutionCode,
          resolution: input.reason.trim(),
          mappingTargetId: input.mappingTargetId ?? null,
          resolvedByUserId: identity.userId,
          resolvedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) precondition();
      await this.applyItemResolution(tx, old, input);
      const row = await tx.dQIssue.findUnique({ where: { id } });
      if (!row) missing("DQ_ISSUE_NOT_FOUND");
      await this.remember(
        tx,
        identity,
        "post_data_quality_issues_by_issueId_resolve",
        key!,
        requestHash,
        id,
      );
      await this.record(
        tx,
        identity,
        "DQ_ISSUE_RESOLVED",
        "DataQualityIssue",
        id,
        { resolutionCode: input.resolutionCode, reason: input.reason },
      );
      return { data: dqDto(row), etag: `\"rv-${row.rowVersion}\"` };
    });
  }

  /**
   * Resolving an unmatched-item issue has to change the data, not just close
   * the ticket. Otherwise the reviewer picks "map to this product", the issue
   * disappears, and the order lines stay exactly as wrong as they were.
   *
   * The fix is applied to every line carrying the same ordered item, because
   * the same code appears on many orders and fixing one of them is not a fix.
   */
  private async applyItemResolution(
    tx: TransactionClient,
    issue: Prisma.DQIssueGetPayload<object>,
    input: ResolveIssueDto,
  ) {
    if (issue.sourceEntityCode !== "PRODUCT") return;
    const orderedItem = issue.sourceRecordKey.trim();
    if (orderedItem === "") return;
    const where = { orderedItemRaw: orderedItem };

    if (input.resolutionCode === "MAP_TO_EXISTING") {
      if (!input.mappingTargetId) rule("MAPPING_TARGET_REQUIRED");
      const product = await tx.product.findUnique({
        where: { id: input.mappingTargetId },
        select: { id: true },
      });
      if (!product) rule("MAPPING_TARGET_NOT_FOUND");
      await tx.eRPOrderLine.updateMany({
        where,
        data: {
          productId: product.id,
          // A human decision is recorded as its own match status so it is never
          // mistaken for something the importer worked out on its own.
          matchStatusCode: "MATCHED_MANUAL",
          itemClassificationCode: "SELLABLE_PRODUCT",
          dqStatusCode: "VALID",
        },
      });
      return;
    }

    if (input.resolutionCode === "CLASSIFY_SERVICE") {
      await tx.eRPOrderLine.updateMany({
        where,
        data: { itemClassificationCode: "SERVICE", dqStatusCode: "VALID" },
      });
      return;
    }

    if (input.resolutionCode === "CLASSIFY_LOGISTICS") {
      await tx.eRPOrderLine.updateMany({
        where,
        data: {
          itemClassificationCode: "LOGISTICS_CHARGE",
          dqStatusCode: "VALID",
        },
      });
      return;
    }

    if (input.resolutionCode === "CREATE_PRODUCT") {
      const line = await tx.eRPOrderLine.findFirst({
        where,
        select: { itemDescriptionRaw: true, itemClassRaw: true },
      });
      const description =
        line?.itemDescriptionRaw?.trim() ?? `Item ${orderedItem}`;
      const family = await tx.productFamily.upsert({
        where: { familyCode: "IMPORT_REVIEW" },
        create: {
          familyCode: "IMPORT_REVIEW",
          name: "Created from import review",
          active: true,
        },
        update: {},
      });
      const created = await tx.product.create({
        data: {
          skuCode: orderedItem,
          barcode: orderedItem,
          productFamilyId: family.id,
          productTypeCode: "STANDARD_SKU",
          canonicalDescription: description,
          normalizedDescription: description.toLowerCase(),
          itemClassificationCode: "SELLABLE_PRODUCT",
          // Created because someone sold it, not because it is in the catalogue.
          // IN_COSTING keeps it out of "currently sellable" until it is priced.
          productStatusCode: "IN_COSTING",
          itemClassRaw: line?.itemClassRaw ?? null,
          createdByUserId: issue.resolvedByUserId ?? undefined,
          updatedByUserId: issue.resolvedByUserId ?? undefined,
        } as Prisma.ProductUncheckedCreateInput,
      });
      await tx.eRPOrderLine.updateMany({
        where,
        data: {
          productId: created.id,
          matchStatusCode: "MATCHED_MANUAL",
          itemClassificationCode: "SELLABLE_PRODUCT",
          dqStatusCode: "VALID",
        },
      });
      return;
    }

    if (input.resolutionCode === "WAIVE" || input.resolutionCode === "IGNORE") {
      // Nothing is changed on the data: the reviewer has said the line is fine
      // as it is, and the issue record keeps their reason.
      await tx.eRPOrderLine.updateMany({
        where,
        data: { dqStatusCode: "WAIVED" },
      });
    }
  }

  async createReconciliation(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateReconciliationRunDto,
  ) {
    this.require(identity, permissions.reconciliationRun);
    requireKey(key);
    const requestHash = hashJson(input);
    return this.txs.run(identity, async (tx) => {
      const replay = await this.replay(
        tx,
        identity,
        "post_reconciliation_runs",
        key!,
        requestHash,
      );
      if (replay)
        return { data: reconciliationDto(await requiredRun(tx, replay)) };
      const row = await tx.reconciliationRun.create({
        data: {
          reconciliationTypeCode: input.reconciliationTypeCode,
          sourceSystemId: input.sourceSystemId ?? null,
          filterJson: (input.filters ?? {}) as Prisma.InputJsonValue,
          createdByUserId: identity.userId,
          statusCode: "PENDING",
        },
      });
      const job = await this.jobs.enqueue(tx, {
        type: "RECONCILIATION_RUN",
        payload: {
          runId: row.id,
          reconciliationTypeCode: row.reconciliationTypeCode,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key!,
        sourceType: "ReconciliationRun",
        sourceId: row.id,
      });
      const updated = await tx.reconciliationRun.update({
        where: { id: row.id },
        data: { jobId: job.jobId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "RECONCILIATION_REQUESTED",
        aggregateType: "ReconciliationRun",
        aggregateId: row.id,
        payload: { runId: row.id, jobId: job.jobId },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key!,
      });
      await this.remember(
        tx,
        identity,
        "post_reconciliation_runs",
        key!,
        requestHash,
        row.id,
      );
      await this.record(
        tx,
        identity,
        "RECONCILIATION_REQUESTED",
        "ReconciliationRun",
        row.id,
        { jobId: job.jobId },
      );
      return { data: reconciliationDto(updated) };
    });
  }
  async listReconciliations(
    identity: CustomerIdentity,
    query: ReconciliationListQuery,
  ) {
    this.require(identity, permissions.reconciliationView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.ReconciliationRunWhereInput = {
      createdByUserId: identity.userId,
      ...(query.statusCode ? { statusCode: query.statusCode } : {}),
      ...(query.reconciliationTypeCode
        ? { reconciliationTypeCode: query.reconciliationTypeCode }
        : {}),
      ...(query.importJobId ? { importBatchId: query.importJobId } : {}),
      ...(query.search
        ? {
            reconciliationTypeCode: {
              contains: query.search.trim(),
              mode: "insensitive",
            },
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.reconciliationRun.count({ where }),
      this.db.reconciliationRun.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return listEnvelope(
      rows.map(reconciliationDto),
      offset,
      query.limit,
      total,
    );
  }
  async getReconciliation(identity: CustomerIdentity, id: string) {
    this.require(identity, permissions.reconciliationView);
    return { data: reconciliationDto(await this.ownedRun(identity, id)) };
  }
  async reconciliationIssues(
    identity: CustomerIdentity,
    id: string,
    query: ImportListQuery,
  ) {
    this.require(identity, permissions.reconciliationView);
    await this.ownedRun(identity, id);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.ReconciliationIssueWhereInput = {
      runId: id,
      ...(query.search
        ? {
            OR: [
              {
                issueCode: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                sourceKey: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.reconciliationIssue.count({ where }),
      this.db.reconciliationIssue.findMany({
        where,
        orderBy: [{ id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return listEnvelope(
      rows.map(reconciliationIssueDto),
      offset,
      query.limit,
      total,
    );
  }
  async resolveReconciliationIssue(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    ifMatch: string | undefined,
    input: ResolveReconciliationIssueDto,
  ) {
    this.require(identity, permissions.reconciliationManage);
    requireKey(key);
    const expected = etagVersion(ifMatch);
    const requestHash = hashJson({ id, input });
    const prior = await this.replay(
      this.db,
      identity,
      "post_reconciliation_issues_by_issueId_resolve",
      key!,
      requestHash,
    );
    if (prior) {
      const replay = await this.db.reconciliationIssue.findUnique({
        where: { id: prior },
      });
      if (!replay) missing("RECONCILIATION_ISSUE_NOT_FOUND");
      return {
        data: reconciliationIssueDto(replay),
        etag: `"rv-${replay.rowVersion.toString()}"`,
      };
    }
    return this.txs.run(identity, async (tx) => {
      const old = await tx.reconciliationIssue.findUnique({ where: { id } });
      if (!old) missing("RECONCILIATION_ISSUE_NOT_FOUND");
      const run = await requiredRun(tx, old.runId);
      if (run.createdByUserId !== identity.userId)
        missing("RECONCILIATION_ISSUE_NOT_FOUND");
      if (old.statusCode !== "OPEN")
        conflict("RECONCILIATION_ISSUE_ALREADY_RESOLVED");
      const changed = await tx.reconciliationIssue.updateMany({
        where: { id, rowVersion: expected },
        data: {
          statusCode: input.resolutionCode === "WAIVE" ? "WAIVED" : "RESOLVED",
          resolutionCode: input.resolutionCode,
          resolutionReason: input.reason,
          resourceId: input.resourceId ?? null,
          resolvedByUserId: identity.userId,
          resolvedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.reconciliationIssue.findUnique({ where: { id } });
      if (!row) missing("RECONCILIATION_ISSUE_NOT_FOUND");
      await this.remember(
        tx,
        identity,
        "post_reconciliation_issues_by_issueId_resolve",
        key!,
        requestHash,
        id,
      );
      await this.record(
        tx,
        identity,
        "RECONCILIATION_ISSUE_RESOLVED",
        "ReconciliationIssue",
        id,
        { resolutionCode: input.resolutionCode, reason: input.reason },
      );
      return {
        data: reconciliationIssueDto(row),
        etag: `\"rv-${row.rowVersion}\"`,
      };
    });
  }

  async resolveItem(
    identity: CustomerIdentity,
    key: string | undefined,
    input: ResolveItemDto,
  ) {
    this.require(identity, permissions.itemResolverUse);
    requireKey(key);
    const requestHash = hashJson(input);
    const prior = await this.replay(
      this.db,
      identity,
      "post_item_resolver_resolve",
      key!,
      requestHash,
    );
    if (prior) {
      const product = await this.db.product.findUnique({
        where: { id: prior },
      });
      if (product)
        return {
          data: {
            statusCode: "EXACT",
            product: productDto(product),
            candidates: [],
            dataQualityIssueId: null,
          },
        };
      const issue = await this.db.dQIssue.findUnique({ where: { id: prior } });
      if (issue)
        return {
          data: {
            statusCode: "UNRESOLVED",
            candidates: [],
            dataQualityIssueId: issue.id,
          },
        };
      conflict("IDEMPOTENCY_REPLAY_MISSING");
    }
    let product = null;
    let mapping = null;
    if (input.sourceSystemId && input.sourceItemKey) {
      const source = await this.db.sourceItem.findUnique({
        where: {
          sourceSystemId_sourceItemKey: {
            sourceSystemId: input.sourceSystemId,
            sourceItemKey: input.sourceItemKey,
          },
        },
      });
      if (source)
        mapping = await this.db.itemMapping.findFirst({
          where: { sourceItemId: source.id, statusCode: "ACTIVE" },
          orderBy: { mappedAt: "desc" },
        });
      if (mapping)
        product = await this.db.product.findUnique({
          where: { id: mapping.productId },
        });
    }
    if (!product && input.sku)
      product = await this.db.product.findUnique({
        where: { skuCode: input.sku },
      });
    if (!product && input.barcode)
      product = await this.db.product.findUnique({
        where: { barcode: input.barcode },
      });
    return this.txs.run(identity, async (tx) => {
      if (product) {
        await this.remember(
          tx,
          identity,
          "post_item_resolver_resolve",
          key!,
          requestHash,
          product.id,
        );
        return {
          data: {
            statusCode: "EXACT",
            product: productDto(product),
            candidates: [],
            dataQualityIssueId: null,
          },
        };
      }
      const issue = await tx.dQIssue.create({
        data: {
          sourceEntityCode: "ITEM",
          sourceRecordKey:
            input.sourceItemKey ??
            input.sku ??
            input.barcode ??
            hashJson(input),
          ruleCode: "DATA_CONFLICT",
          severityCode: "BLOCKER",
          message: "No deterministic canonical item mapping exists.",
        },
      });
      await this.remember(
        tx,
        identity,
        "post_item_resolver_resolve",
        key!,
        requestHash,
        issue.id,
      );
      return {
        data: {
          statusCode: "UNRESOLVED",
          candidates: [],
          dataQualityIssueId: issue.id,
        },
      };
    });
  }
  async createItemMapping(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateItemMappingDto,
  ) {
    this.require(identity, permissions.itemResolverManage);
    requireKey(key);
    const requestHash = hashJson(input);
    const prior = await this.replay(
      this.db,
      identity,
      "post_item_resolver_mappings",
      key!,
      requestHash,
    );
    if (prior) {
      const replay = await this.db.itemMapping.findUnique({
        where: { id: prior },
      });
      if (!replay) conflict("IDEMPOTENCY_REPLAY_MISSING");
      return { data: itemMappingDto(replay) };
    }
    return this.txs.run(identity, async (tx) => {
      const source = await tx.sourceItem.findUnique({
        where: { id: input.sourceItemId },
      });
      if (!source) missing("SOURCE_ITEM_NOT_FOUND");
      if (!(await tx.product.findUnique({ where: { id: input.productId } })))
        missing("PRODUCT_NOT_FOUND");
      await tx.itemMapping.updateMany({
        where: { sourceItemId: input.sourceItemId, statusCode: "ACTIVE" },
        data: { statusCode: "REPLACED" },
      });
      const row = await tx.itemMapping.create({
        data: {
          sourceItemId: input.sourceItemId,
          productId: input.productId,
          mappingMethodCode: input.mappingMethodCode,
          confidencePct: input.confidencePct ?? null,
          mappedByUserId: identity.userId,
          rationale: input.rationale,
        },
      });
      await this.remember(
        tx,
        identity,
        "post_item_resolver_mappings",
        key!,
        requestHash,
        row.id,
      );
      await this.record(
        tx,
        identity,
        "ITEM_MAPPING_CREATED",
        "ItemMapping",
        row.id,
        {
          sourceItemId: row.sourceItemId,
          productId: row.productId,
          mappingMethodCode: row.mappingMethodCode,
        },
      );
      return { data: itemMappingDto(row) };
    });
  }

  private async command(
    identity: CustomerIdentity,
    id: string,
    key: string,
    operation: string,
    input: object,
    states: string[],
    next: string,
    jobType: string,
    eventType: string,
  ) {
    const requestHash = hashJson({ id, input });
    return this.txs.run(identity, async (tx) => {
      const replay = await this.replay(
        tx,
        identity,
        operation,
        key,
        requestHash,
      );
      if (replay) return { data: importDto(await requiredBatch(tx, replay)) };
      const old = await requiredBatch(tx, id);
      if (old.actorUserId !== identity.userId) missing("IMPORT_JOB_NOT_FOUND");
      if (!states.includes(old.statusCode)) conflict("IMPORT_STATE_CONFLICT");
      const job = await this.jobs.enqueue(tx, {
        type: jobType,
        payload: { importJobId: id, ...input },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
        sourceType: "ImportJob",
        sourceId: id,
      });
      const row = await tx.importBatch.update({
        where: { id },
        data: { statusCode: next, rowVersion: { increment: 1 } },
      });
      await this.outbox.enqueue(tx, {
        eventType,
        aggregateType: "ImportJob",
        aggregateId: id,
        payload: { importJobId: id, jobId: job.jobId },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
      });
      await this.remember(tx, identity, operation, key, requestHash, id);
      await this.record(tx, identity, eventType, "ImportJob", id, {
        jobId: job.jobId,
      });
      return { data: importDto(row) };
    });
  }
  private require(identity: CustomerIdentity, permission: string) {
    if (
      identity.deniedPermissions.has(permission) ||
      !identity.permissions.has(permission) ||
      !["SALES", "OPERATIONS", "FINANCE"].some((workspace) =>
        hasWorkspace(identity, workspace),
      )
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
  private async ownedBatch(identity: CustomerIdentity, id: string) {
    const row = await this.db.importBatch.findFirst({
      where: {
        id,
        ...(isSystemAdmin(identity) ? {} : { actorUserId: identity.userId }),
      },
    });
    if (!row) missing("IMPORT_JOB_NOT_FOUND");
    return row;
  }
  private async ownedRun(identity: CustomerIdentity, id: string) {
    const row = await this.db.reconciliationRun.findFirst({
      where: { id, createdByUserId: identity.userId },
    });
    if (!row) missing("RECONCILIATION_RUN_NOT_FOUND");
    return row;
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
  private remember(
    tx: TransactionClient,
    identity: CustomerIdentity,
    operation: string,
    key: string,
    requestHash: string,
    id: string,
  ) {
    return tx.commandIdempotency.create({
      data: {
        actorUserId: identity.userId,
        operationCode: operation,
        idempotencyKey: key,
        requestHash,
        responseResourceId: id,
      },
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
      workspace: [...identity.workspaces][0] ?? "SALES",
      countryCode: null,
      metadata,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "import-api",
    });
  }
}

function importDto(r: Prisma.ImportBatchGetPayload<object>) {
  return {
    importJobId: r.id,
    // The human-facing job reference and its counters. Without these the import
    // centre can list jobs but cannot tell you what any of them actually did.
    jobRef: r.jobRef,
    label: r.label,
    summary: r.summary ?? null,
    createdAt: r.createdAt.toISOString(),
    sourceSystemId: r.sourceSystemId,
    importTypeCode: r.importTypeCode,
    fileName: r.fileName,
    fileSha256: r.fileSha256,
    statusCode: r.statusCode,
    createdByUserId: r.actorUserId,
    previewedAt: r.previewedAt?.toISOString() ?? null,
    committedAt: r.committedAt?.toISOString() ?? null,
    rolledBackAt: r.rolledBackAt?.toISOString() ?? null,
    currentPreviewAttemptId: r.currentPreviewAttemptId,
    currentPreviewFingerprint: r.currentPreviewFingerprint,
    statusUrl: `/api/v1/import-jobs/${r.id}`,
  };
}
function dqDto(r: Prisma.DQIssueGetPayload<object>) {
  return {
    issueId: r.id,
    importJobId: r.importBatchId,
    importRowId: r.importRowId,
    resourceTypeCode: r.resourceTypeCode,
    resourceId: r.resourceId,
    issueCode: r.ruleCode,
    severityCode: r.severityCode,
    message: r.message,
    statusCode: r.statusCode,
  };
}
function dqDetailDto(r: Prisma.DQIssueGetPayload<object>) {
  return {
    ...dqDto(r),
    sourceEntityCode: r.sourceEntityCode,
    sourceRecordKey: r.sourceRecordKey,
    resolutionCode: r.resolutionCode,
    resolution: r.resolution,
    mappingTargetId: r.mappingTargetId,
    resolvedByUserId: r.resolvedByUserId,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    rowVersion: r.rowVersion.toString(),
    createdAt: r.createdAt.toISOString(),
  };
}
function reconciliationDto(r: Prisma.ReconciliationRunGetPayload<object>) {
  return {
    reconciliationRunId: r.id,
    reconciliationTypeCode: r.reconciliationTypeCode,
    sourceSystemId: r.sourceSystemId,
    statusCode: r.statusCode,
    filterJsonb: r.filterJson,
    summaryJsonb: r.summary,
    createdByUserId: r.createdByUserId,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    statusUrl: `/api/v1/reconciliation-runs/${r.id}`,
  };
}
function reconciliationIssueDto(
  r: Prisma.ReconciliationIssueGetPayload<object>,
) {
  return {
    reconciliationIssueId: r.id,
    runId: r.runId,
    issueCode: r.issueCode,
    severityCode: r.severityCode,
    sourceKey: r.sourceKey,
    resourceTypeCode: r.resourceTypeCode,
    resourceId: r.resourceId,
    detailsJsonb: jsonObject(r.details),
    statusCode: r.statusCode,
    resolutionCode: r.resolutionCode,
    resolvedByUserId: r.resolvedByUserId,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}
function itemMappingDto(r: Prisma.ItemMappingGetPayload<object>) {
  return {
    mappingId: r.id,
    sourceItemId: r.sourceItemId,
    productId: r.productId,
    mappingMethodCode: r.mappingMethodCode,
    confidencePct: r.confidencePct?.toString() ?? null,
    mappedByUserId: r.mappedByUserId,
    mappedAt: r.mappedAt.toISOString(),
    rationale: r.rationale,
    statusCode: r.statusCode,
  };
}
function productDto(r: Prisma.ProductGetPayload<object>) {
  return {
    productId: r.id,
    skuCode: r.skuCode,
    barcode: r.barcode,
    productFamilyId: r.productFamilyId,
    productTypeCode: r.productTypeCode,
    canonicalDescription: r.canonicalDescription,
    thicknessMm: r.thicknessMm?.toString() ?? null,
    widthMm: r.widthMm?.toString() ?? null,
    lengthMm: r.lengthMm?.toString() ?? null,
    weightKg: r.weightKg?.toString() ?? null,
    densityKgM3: r.densityKgM3?.toString() ?? null,
    statusCode: r.recordStatusCode,
  };
}
function listEnvelope<T>(
  data: T[],
  offset: number,
  limit: number,
  total: number,
) {
  return {
    data,
    meta: {
      page: Math.floor(offset / limit) + 1,
      offset,
      limit,
      total,
      hasNext: offset + data.length < total,
    },
  };
}
async function requiredBatch(
  db: Pick<DatabaseClient, "importBatch"> | TransactionClient,
  id: string,
) {
  const row = await db.importBatch.findUnique({ where: { id } });
  if (!row) missing("IMPORT_JOB_NOT_FOUND");
  return row;
}
async function requiredRun(
  db: Pick<DatabaseClient, "reconciliationRun"> | TransactionClient,
  id: string,
) {
  const row = await db.reconciliationRun.findUnique({ where: { id } });
  if (!row) missing("RECONCILIATION_RUN_NOT_FOUND");
  return row;
}
function validateFileMetadata(i: CreateImportJobDto) {
  const ext = extensionOf(i.fileName);
  if (
    ![".csv", ".xlsx"].includes(ext) ||
    /[\\/]/.test(i.fileName) ||
    i.fileName.includes("..")
  )
    rule("IMPORT_FILE_TYPE_REJECTED");
  const mime = i.mimeType.toLowerCase();
  if (
    ext === ".csv" &&
    !["text/csv", "application/csv", "text/plain"].includes(mime)
  )
    rule("IMPORT_MIME_MISMATCH");
  if (
    ext === ".xlsx" &&
    ![
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ].includes(mime)
  )
    rule("IMPORT_MIME_MISMATCH");
}
function extensionOf(name: string) {
  const at = name.lastIndexOf(".");
  return at < 0 ? "" : name.slice(at).toLowerCase();
}
function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 255);
}
function normalizeRecord(
  row: Record<string, string | number | boolean | null>,
) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.trim(),
      typeof v === "string" ? v.trim() : v,
    ]),
  );
}
function jsonObject(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function stableUuid(value: string) {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function requireKey(key: string | undefined) {
  if (!key || key.length < 8 || key.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
}
function etagVersion(value: string | undefined) {
  const m = /^(?:W\/)?\"?rv-(\d+)\"?$/.exec(value ?? "");
  if (!m) throw new ApiProblem({ status: 400, code: "IF_MATCH_REQUIRED" });
  return BigInt(m[1]!);
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
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
}
