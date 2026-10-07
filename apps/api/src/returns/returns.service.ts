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
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type {
  ApproveReturnDto,
  CreateReturnDto,
  ExpectedReturnDto,
  ReturnLineDto,
  ReturnListQuery,
  UpdateReturnDto,
} from "./returns.dto.js";
const POLICY = "25000000-0000-4000-8000-000000000025";
@Injectable()
export class ReturnsService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}
  async list(i: CustomerIdentity, q: ReturnListQuery) {
    this.require(i, permissions.returnsView);
    const offset = q.offset ?? (q.page - 1) * q.limit,
      where: Prisma.ReturnedScrapRequestWhereInput = {
        countryCode: { in: [...i.countryCodes] },
        account: { OR: accountAccess(i) },
        ...(q.search
          ? { caseRef: { contains: q.search, mode: "insensitive" } }
          : {}),
      };
    const [total, rows] = await this.db.$transaction([
      this.db.returnedScrapRequest.count({ where }),
      this.db.returnedScrapRequest.findMany({
        where,
        orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    return {
      data: rows.map(caseHeader),
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
    this.require(i, permissions.returnsView);
    return { data: await this.detail(this.db, i, id) };
  }
  async create(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateReturnDto,
  ) {
    this.require(i, permissions.returnsCreate);
    key = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const requestHash = hash(b),
        replay = await this.replay(
          tx,
          i,
          "post_returned_scrap_cases",
          key,
          requestHash,
        );
      if (replay) return { data: await this.detail(tx, i, replay) };
      const quote = await tx.quotation.findFirst({
        where: {
          id: b.originalQuotationId,
          accountId: b.accountId,
          countryCode: { in: [...i.countryCodes] },
          account: { OR: accountAccess(i) },
        },
      });
      if (!quote || !quote.currencyCode)
        missing("ORIGINAL_QUOTATION_NOT_FOUND");
      const calculated = await this.calculate(
        tx,
        b.originalQuotationId,
        b.lines,
        b.benefitTypeCode,
      );
      const id = randomUUID(),
        row = await tx.returnedScrapRequest.create({
          data: {
            id,
            caseRef: `RSC-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`,
            accountId: b.accountId,
            originalQuotationId: b.originalQuotationId,
            countryCode: quote.countryCode,
            policyId: POLICY,
            currencyCodeSnapshot: quote.currencyCode,
            benefitTypeCode: b.benefitTypeCode,
            statusCode: "DRAFT",
            requestedByUserId: i.userId,
            assessedBaseAmount: calculated.base,
            benefitValueAmount: calculated.benefit,
            assessmentHash: calculated.hash,
          },
        });
      await this.replaceLines(tx, row.id, calculated.lines, b.benefitTypeCode);
      await this.remember(
        tx,
        i,
        "post_returned_scrap_cases",
        key,
        requestHash,
        row.id,
      );
      await this.record(tx, i, "RETURNED_SCRAP_CREATED", row.id, {
        originalQuotationId: b.originalQuotationId,
        benefitRate: "0.25",
      });
      return { data: await this.detail(tx, i, row.id) };
    });
  }
  async update(
    i: CustomerIdentity,
    ifMatch: string | undefined,
    id: string,
    b: UpdateReturnDto,
  ) {
    this.require(i, permissions.returnsEdit);
    const expected = parseEtag(ifMatch);
    return this.txs.run(i, async (tx) => {
      const row = await this.case(tx, i, id);
      if (row.statusCode !== "DRAFT") conflict("RETURNED_SCRAP_NOT_DRAFT");
      if (row.rowVersion !== expected) precondition();
      let base = row.assessedBaseAmount,
        benefit = row.benefitValueAmount,
        assessmentHash = row.assessmentHash;
      if (b.lines) {
        const c = await this.calculate(
          tx,
          row.originalQuotationId,
          b.lines,
          b.benefitTypeCode ?? row.benefitTypeCode,
        );
        base = c.base;
        benefit = c.benefit;
        assessmentHash = c.hash;
        await tx.returnedScrapItem.deleteMany({
          where: { returnedScrapRequestId: id },
        });
        await this.replaceLines(
          tx,
          id,
          c.lines,
          b.benefitTypeCode ?? row.benefitTypeCode,
        );
      } else if (b.benefitTypeCode)
        await tx.returnedScrapItem.updateMany({
          where: { returnedScrapRequestId: id },
          data: { benefitTypeCode: b.benefitTypeCode },
        });
      const updated = await tx.returnedScrapRequest.update({
        where: { id },
        data: {
          ...(b.benefitTypeCode ? { benefitTypeCode: b.benefitTypeCode } : {}),
          ...(b.receivedAt !== undefined
            ? { receivedAt: b.receivedAt ? new Date(b.receivedAt) : null }
            : {}),
          assessedBaseAmount: base,
          benefitValueAmount: benefit,
          assessmentHash,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, i, "RETURNED_SCRAP_UPDATED", id, {
        benefitRate: "0.25",
      });
      return {
        data: await this.detail(tx, i, id),
        etag: etag(updated.rowVersion),
      };
    });
  }
  async submit(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: ExpectedReturnDto,
  ) {
    this.require(i, permissions.returnsEdit);
    return this.command(
      i,
      key,
      id,
      b,
      "post_returned_scrap_submit",
      permissions.returnsEdit,
      ["DRAFT"],
      "PENDING_APPROVAL",
      "RETURNED_SCRAP_APPROVAL_REQUESTED",
      { submittedAt: new Date() },
    );
  }
  async approve(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: ApproveReturnDto,
  ) {
    this.require(i, permissions.returnsApprove);
    if (
      i.deniedPermissions.has(permissions.salesManagementView) ||
      !i.permissions.has(permissions.salesManagementView)
    )
      forbidden();
    const target = b.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    return this.command(
      i,
      key,
      id,
      b,
      "post_returned_scrap_approve",
      permissions.returnsApprove,
      ["PENDING_APPROVAL"],
      target,
      b.decision === "APPROVE"
        ? "RETURNED_SCRAP_APPROVED"
        : "RETURNED_SCRAP_REJECTED",
      b.decision === "APPROVE"
        ? { approvedByUserId: i.userId, approvedAt: new Date() }
        : {
            rejectedByUserId: i.userId,
            rejectedAt: new Date(),
            rejectionReason: b.comment ?? "Rejected",
          },
    );
  }
  async finalize(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: ExpectedReturnDto,
  ) {
    this.require(i, permissions.returnsFinalize);
    return this.command(
      i,
      key,
      id,
      b,
      "post_returned_scrap_finalize",
      permissions.returnsFinalize,
      ["APPROVED"],
      "FINALIZED",
      "RETURNED_SCRAP_FINALIZED",
      { finalizedByUserId: i.userId, finalizedAt: new Date() },
    );
  }
  private async command(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: ExpectedReturnDto,
    op: string,
    p: string,
    states: string[],
    target: string,
    event: string,
    data: Prisma.ReturnedScrapRequestUpdateInput,
  ) {
    this.require(i, p);
    key = requireKey(key);
    return this.txs.run(
      i,
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT returned_scrap_request_id FROM returned_scrap_requests WHERE returned_scrap_request_id=${id}::uuid FOR UPDATE`,
        );
        const row = await this.case(tx, i, id);
        if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
        if (!states.includes(row.statusCode))
          conflict("RETURNED_SCRAP_STATE_CONFLICT");
        const requestHash = hash({ id, b }),
          replay = await this.replay(tx, i, op, key, requestHash);
        if (replay) {
          const current = await this.case(tx, i, id);
          return {
            data: await this.detail(tx, i, current.id),
            etag: etag(current.rowVersion),
          };
        }
        if (target === "PENDING_APPROVAL") {
          await this.assertCumulativeEligibility(tx, id);
        }
        const updated = await tx.returnedScrapRequest.update({
          where: { id },
          data: { ...data, statusCode: target, rowVersion: { increment: 1 } },
        });
        await this.remember(tx, i, op, key, requestHash, id);
        await this.record(tx, i, event, id, {
          from: row.statusCode,
          to: target,
          assessmentHash: row.assessmentHash,
        });
        return {
          data: await this.detail(tx, i, id),
          etag: etag(updated.rowVersion),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  private async assertCumulativeEligibility(
    tx: TransactionClient,
    requestId: string,
  ) {
    const violations = await tx.$queryRaw<Array<{ line_id: string }>>(
      Prisma.sql`
        SELECT current_item.original_quotation_line_id::text AS line_id
        FROM returned_scrap_items current_item
        JOIN quotation_lines original_line
          ON original_line.quotation_line_id = current_item.original_quotation_line_id
        WHERE current_item.returned_scrap_request_id = ${requestId}::uuid
          AND current_item.returned_qty + COALESCE((
            SELECT SUM(other_item.returned_qty)
            FROM returned_scrap_items other_item
            JOIN returned_scrap_requests other_request
              ON other_request.returned_scrap_request_id = other_item.returned_scrap_request_id
            WHERE other_item.original_quotation_line_id = current_item.original_quotation_line_id
              AND other_item.returned_scrap_request_id <> ${requestId}::uuid
              AND other_request.status_code IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED')
          ), 0) > original_line.qty
        FOR UPDATE OF original_line
      `,
    );
    if (violations.length > 0) rule("RETURNED_SCRAP_CUMULATIVE_QTY_EXCEEDED");
  }
  private async calculate(
    tx: TransactionClient,
    quoteId: string,
    lines: ReturnLineDto[],
    benefitType: string,
  ) {
    if (
      new Set(lines.map((x) => x.originalQuotationLineId)).size !== lines.length
    )
      rule("RETURNED_SCRAP_DUPLICATE_LINE");
    let base = new Prisma.Decimal(0);
    const out = [];
    for (const input of lines) {
      const source = await tx.quotationLine.findFirst({
        where: { id: input.originalQuotationLineId, quotationId: quoteId },
      });
      if (!source) missing("ORIGINAL_QUOTATION_LINE_NOT_FOUND");
      const qty = new Prisma.Decimal(input.returnedQty);
      if (!qty.isPositive() || qty.greaterThan(source.qty))
        rule("RETURNED_SCRAP_QTY_INVALID");
      const lineBase = source.unitPrice.mul(qty),
        lineBenefit = lineBase.mul("0.25");
      base = base.add(lineBase);
      out.push({ source, qty, lineBase, lineBenefit });
    }
    return {
      base,
      benefit: base.mul("0.25"),
      hash: hash(
        out.map((x) => ({
          lineId: x.source.id,
          qty: x.qty.toString(),
          unitPrice: x.source.unitPrice.toString(),
          benefitType,
        })),
      ),
      lines: out,
    };
  }
  private async replaceLines(
    tx: TransactionClient,
    id: string,
    lines: Awaited<ReturnType<ReturnsService["calculate"]>>["lines"],
    benefitType: string,
  ) {
    for (const x of lines)
      await tx.returnedScrapItem.create({
        data: {
          returnedScrapRequestId: id,
          originalQuotationLineId: x.source.id,
          eligibleReturnedQty: x.qty,
          returnedQty: x.qty,
          originalPurchaseUnitPrice: x.source.unitPrice,
          eligibleBaseAmount: x.lineBase,
          benefitRate: "0.25",
          benefitAmount: x.lineBenefit,
          benefitTypeCode: benefitType,
          productId: x.source.productId,
          unitCode: x.source.unitCode,
        },
      });
  }
  private async case(
    tx: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const row = await tx.returnedScrapRequest.findFirst({
      where: {
        id,
        countryCode: { in: [...i.countryCodes] },
        account: { OR: accountAccess(i) },
      },
    });
    if (!row) missing("RETURNED_SCRAP_NOT_FOUND");
    return row;
  }
  private async detail(
    tx: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const row = await this.case(tx, i, id),
      lines = await tx.returnedScrapItem.findMany({
        where: { returnedScrapRequestId: id },
        orderBy: { id: "asc" },
      });
    return {
      case: caseHeader(row),
      lines: lines.map((x) => ({
        returnedScrapLineId: x.id,
        caseId: x.returnedScrapRequestId,
        originalQuotationLineId: x.originalQuotationLineId,
        productId: x.productId,
        returnedQty: x.returnedQty.toString(),
        unitCode: x.unitCode,
        originalPurchaseUnitPriceSnapshot:
          x.originalPurchaseUnitPrice.toString(),
        eligibleBaseAmount: x.eligibleBaseAmount.toString(),
        benefitValueAmount: x.benefitAmount.toString(),
        createdAt: x.createdAt.toISOString(),
      })),
      approvalRequired: true,
      canFinalize: row.statusCode === "APPROVED",
    };
  }
  private require(i: CustomerIdentity, p: string) {
    if (
      (!hasWorkspace(i, "SALES") && !hasWorkspace(i, "FINANCE")) ||
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p)
    )
      forbidden();
  }
  private replay(
    tx: TransactionClient,
    i: CustomerIdentity,
    op: string,
    key: string,
    h: string,
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
        if (r && r.requestHash !== h) conflict("IDEMPOTENCY_KEY_REUSED");
        return r?.responseResourceId;
      });
  }
  private remember(
    tx: TransactionClient,
    i: CustomerIdentity,
    op: string,
    key: string,
    h: string,
    id: string,
  ) {
    return tx.commandIdempotency.create({
      data: {
        actorUserId: i.userId,
        operationCode: op,
        idempotencyKey: key,
        requestHash: h,
        responseResourceId: id,
      },
    });
  }
  private record(
    tx: TransactionClient,
    i: CustomerIdentity,
    actionCode: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode,
      resourceType: "ReturnedScrapCase",
      resourceId: id,
      workspace: "SALES",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "returns-api",
    });
  }
}
function caseHeader(r: Prisma.ReturnedScrapRequestGetPayload<object>) {
  return {
    returnedScrapCaseId: r.id,
    caseRef: r.caseRef,
    accountId: r.accountId,
    salesOrderId: null,
    countryCode: r.countryCode.trim(),
    statusCode: r.statusCode,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    policyId: r.policyId,
    appliedCreditPctSnapshot: r.appliedCreditPctSnapshot.toString(),
    assessedBaseAmount: r.assessedBaseAmount.toString(),
    creditAmount: r.benefitValueAmount.toString(),
    originalQuotationId: r.originalQuotationId,
    approvalStatusCode: r.statusCode,
    approvedByUserId: r.approvedByUserId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    benefitTypeCode: r.benefitTypeCode,
    benefitValueAmount: r.benefitValueAmount.toString(),
    currencyCodeSnapshot: r.currencyCodeSnapshot.trim(),
    assessmentHash: r.assessmentHash,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    finalizedByUserId: r.finalizedByUserId,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelReason: null,
    rejectedAt: r.rejectedAt?.toISOString() ?? null,
    rejectedByUserId: r.rejectedByUserId,
    rejectionReason: r.rejectionReason,
    rowVersion: r.rowVersion.toString(),
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
function etag(v: bigint) {
  return `"${v.toString()}"`;
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
