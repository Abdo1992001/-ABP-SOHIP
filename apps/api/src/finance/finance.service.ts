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
  AllocatePaymentDto,
  ChequeTransitionDto,
  CreateChequeDto,
  CreateFxRateDto,
  CreatePaymentDto,
  FinanceListQuery,
  FxResolveQuery,
} from "./finance.dto.js";

@Injectable()
export class FinanceService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}
  async listFx(i: CustomerIdentity, q: FinanceListQuery) {
    this.require(i, permissions.financeFxView);
    const offset = q.offset ?? (q.page - 1) * q.limit,
      where: Prisma.FXRateWhereInput = {
        changedByUserId: { not: null },
        ...(q.search
          ? { sourceCode: { contains: q.search, mode: "insensitive" } }
          : {}),
      };
    const [total, rows] = await this.db.$transaction([
      this.db.fXRate.count({ where }),
      this.db.fXRate.findMany({
        where,
        orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    return { data: rows.map(fxDto), meta: page(q, offset, total, rows.length) };
  }
  async resolveFx(i: CustomerIdentity, q: FxResolveQuery) {
    this.require(i, permissions.financeFxView);
    const at = q.effectiveAt ? new Date(q.effectiveAt) : new Date();
    const row = await this.db.fXRate.findFirst({
      where: {
        baseCurrencyCode: q.baseCurrencyCode,
        quoteCurrencyCode: q.quoteCurrencyCode,
        statusCode: "APPROVED",
        changedByUserId: { not: null },
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    });
    if (!row) missing("FX_RATE_NOT_FOUND");
    return { data: fxDto(row) };
  }
  async createFx(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateFxRateDto,
  ) {
    this.require(i, permissions.financeFxEdit);
    key = requireKey(key);
    const effective = new Date(b.effectiveAt);
    if (effective < new Date(Date.now() - 60_000))
      rule("FX_RETROACTIVE_EDIT_NOT_ALLOWED");
    if (!new Prisma.Decimal(b.rate).isPositive()) rule("FX_RATE_INVALID");
    return this.txs.run(
      i,
      async (tx) => {
        const requestHash = hash(b),
          replay = await this.replay(
            tx,
            i,
            "post_finance_fx_rates",
            key,
            requestHash,
          );
        if (replay)
          return {
            data: fxDto(
              await tx.fXRate.findUniqueOrThrow({ where: { id: replay } }),
            ),
          };
        if (b.supersedesFxRateId) {
          const old = await tx.fXRate.findFirst({
            where: {
              id: b.supersedesFxRateId,
              baseCurrencyCode: "USD",
              quoteCurrencyCode: "EGP",
              statusCode: "APPROVED",
            },
          });
          if (!old) missing("FX_RATE_TO_SUPERSEDE_NOT_FOUND");
          if (old.effectiveFrom >= effective)
            rule("FX_SUPERSESSION_ORDER_INVALID");
          await tx.fXRate.update({
            where: { id: old.id },
            data: { effectiveTo: effective, statusCode: "INACTIVE" },
          });
        }
        const overlap = await tx.fXRate.count({
          where: {
            baseCurrencyCode: "USD",
            quoteCurrencyCode: "EGP",
            statusCode: "APPROVED",
            effectiveFrom: { lte: effective },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effective } }],
          },
        });
        if (overlap) conflict("FX_EFFECTIVE_RANGE_OVERLAP");
        const version =
          (
            await tx.fXRate.aggregate({
              where: { baseCurrencyCode: "USD", quoteCurrencyCode: "EGP" },
              _max: { version: true },
            })
          )._max.version ?? 0;
        const row = await tx.fXRate.create({
          data: {
            baseCurrencyCode: "USD",
            quoteCurrencyCode: "EGP",
            rate: b.rate,
            effectiveFrom: effective,
            version: version + 1,
            sourceCode: "MANUAL",
            statusCode: "APPROVED",
            changedByUserId: i.userId,
            supersedesFxRateId: b.supersedesFxRateId ?? null,
            reason: b.reason,
          },
        });
        await this.remember(
          tx,
          i,
          "post_finance_fx_rates",
          key,
          requestHash,
          row.id,
        );
        await this.record(tx, i, "FX_RATE_CREATED", "FxRate", row.id, {
          rate: row.rate.toString(),
          effectiveAt: b.effectiveAt,
        });
        return { data: fxDto(row) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async listPayments(i: CustomerIdentity, q: FinanceListQuery) {
    this.require(i, permissions.paymentsView);
    const offset = q.offset ?? (q.page - 1) * q.limit,
      where: Prisma.PaymentWhereInput = {
        accountId: q.accountId ?? { not: null },
        account: { countryCode: { in: [...i.countryCodes] } },
        ...(q.search
          ? { sourcePaymentKey: { contains: q.search, mode: "insensitive" } }
          : {}),
      };
    const [total, rows] = await this.db.$transaction([
      this.db.payment.count({ where }),
      this.db.payment.findMany({
        where,
        orderBy: [{ paymentDate: "desc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
        include: { account: { select: { canonicalName: true } } },
      }),
    ]);
    return {
      data: rows.map((row) => paymentListDto(row, row.account?.canonicalName)),
      meta: page(q, offset, total, rows.length),
    };
  }
  async getPayment(i: CustomerIdentity, id: string) {
    this.require(i, permissions.paymentsView);
    const row = await this.db.payment.findUnique({
      where: { id },
      include: {
        account: { select: { countryCode: true, canonicalName: true } },
      },
    });
    if (
      !row?.accountId ||
      !row.account ||
      !i.countryCodes.has(row.account.countryCode.trim())
    )
      missing("PAYMENT_NOT_FOUND");
    const [allocations, corrections, correctedPayment] = await Promise.all([
      this.db.paymentAllocation.findMany({
        where: { paymentId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.db.payment.findMany({
        where: { correctionOfPaymentId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      row.correctionOfPaymentId
        ? this.db.payment.findUnique({
            where: { id: row.correctionOfPaymentId },
          })
        : null,
    ]);
    return {
      data: {
        ...paymentDto(row),
        accountName: row.account.canonicalName,
        source: {
          sourceSystemCode: row.sourceSystemCode,
          sourcePaymentKey: row.sourcePaymentKey,
          sourceTypeCode: row.sourceTypeCode,
          importedAt: row.importedAt.toISOString(),
          rawReference: row.rawReference,
        },
        allocations: allocations.map((a) => ({
          paymentAllocationId: a.id,
          salesOrderId: a.salesOrderId,
          allocatedAmount: a.allocatedAmount.toString(),
          reason: a.reason,
          createdByUserId: a.createdByUserId,
          createdAt: a.createdAt.toISOString(),
        })),
        correctionHistory: {
          corrects: correctedPayment ? paymentListDto(correctedPayment) : null,
          correctedBy: corrections.map((c) => paymentListDto(c)),
        },
      },
    };
  }
  async createPayment(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreatePaymentDto,
  ) {
    this.require(i, permissions.paymentsCreate);
    key = requireKey(key);
    if (!new Prisma.Decimal(b.amount).isPositive())
      rule("PAYMENT_AMOUNT_INVALID");
    return this.txs.run(i, async (tx) => {
      await this.account(tx, i, b.accountId);
      if (b.salesOrderId) await this.order(tx, i, b.salesOrderId, b.accountId);
      if (b.correctionOfPaymentId) {
        const corrected = await tx.payment.findFirst({
          where: { id: b.correctionOfPaymentId, accountId: b.accountId },
        });
        if (!corrected) missing("CORRECTED_PAYMENT_NOT_FOUND");
      }
      const requestHash = hash(b),
        replay = await this.replay(
          tx,
          i,
          "post_finance_payments",
          key,
          requestHash,
        );
      if (replay)
        return {
          data: paymentDto(
            await tx.payment.findUniqueOrThrow({ where: { id: replay } }),
          ),
        };
      const sourceKey = b.sourcePaymentKey ?? `MANUAL-${randomUUID()}`;
      if (b.sourceTypeCode === "IMPORT" && !b.sourcePaymentKey)
        rule("IMPORT_SOURCE_PAYMENT_KEY_REQUIRED");
      const row = await tx.payment.create({
        data: {
          sourceSystemCode: b.sourceTypeCode,
          sourcePaymentKey: sourceKey,
          accountId: b.accountId,
          erpOrderId: b.salesOrderId ?? null,
          paymentDate: new Date(b.paymentDate),
          amount: b.amount,
          currencyCode: b.currencyCode,
          paymentMethodCode: b.paymentMethodCode ?? null,
          statusCode: "ACTIVE",
          rawReference: b.rawReference ?? null,
          sourceTypeCode: b.sourceTypeCode,
          createdByUserId: i.userId,
          correctionOfPaymentId: b.correctionOfPaymentId ?? null,
        },
      });
      await this.remember(
        tx,
        i,
        "post_finance_payments",
        key,
        requestHash,
        row.id,
      );
      await this.record(tx, i, "PAYMENT_CREATED", "Payment", row.id, {
        accountId: b.accountId,
        sourceTypeCode: b.sourceTypeCode,
      });
      return { data: paymentDto(row) };
    });
  }
  async allocate(
    i: CustomerIdentity,
    key: string | undefined,
    b: AllocatePaymentDto,
  ) {
    this.require(i, permissions.paymentsAllocate);
    key = requireKey(key);
    return this.txs.run(
      i,
      async (tx) => {
        const requestHash = hash(b),
          replay = await this.replay(
            tx,
            i,
            "post_finance_payment_allocations",
            key,
            requestHash,
          );
        if (replay)
          return {
            data: paymentDto(
              await tx.payment.findUniqueOrThrow({ where: { id: replay } }),
            ),
          };
        await tx.$queryRaw(
          Prisma.sql`SELECT payment_id FROM payments WHERE payment_id=${b.paymentId}::uuid FOR UPDATE`,
        );
        const payment = await tx.payment.findUnique({
          where: { id: b.paymentId },
        });
        if (!payment?.accountId) missing("PAYMENT_NOT_FOUND");
        await this.account(tx, i, payment.accountId);
        if (payment.statusCode !== "ACTIVE") conflict("PAYMENT_NOT_ACTIVE");
        const current =
          (
            await tx.paymentAllocation.aggregate({
              where: { paymentId: b.paymentId },
              _sum: { allocatedAmount: true },
            })
          )._sum.allocatedAmount ?? new Prisma.Decimal(0);
        let requested = new Prisma.Decimal(0);
        for (const a of b.allocations) {
          const amount = new Prisma.Decimal(a.allocatedAmount);
          if (!amount.isPositive()) rule("PAYMENT_ALLOCATION_INVALID");
          requested = requested.add(amount);
          if (a.salesOrderId)
            await this.order(tx, i, a.salesOrderId, payment.accountId);
        }
        if (current.add(requested).greaterThan(payment.amount))
          conflict("PAYMENT_OVER_ALLOCATION");
        for (const a of b.allocations)
          await tx.paymentAllocation.create({
            data: {
              paymentId: b.paymentId,
              salesOrderId: a.salesOrderId ?? null,
              allocatedAmount: a.allocatedAmount,
              reason: b.reason ?? null,
              createdByUserId: i.userId,
            },
          });
        await this.remember(
          tx,
          i,
          "post_finance_payment_allocations",
          key,
          requestHash,
          payment.id,
        );
        await this.record(tx, i, "PAYMENT_ALLOCATED", "Payment", payment.id, {
          amount: requested.toString(),
          allocationCount: b.allocations.length,
        });
        return { data: paymentDto(payment) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async listCheques(i: CustomerIdentity, q: FinanceListQuery) {
    this.require(i, permissions.chequesView);
    const offset = q.offset ?? (q.page - 1) * q.limit,
      where: Prisma.ChequeWhereInput = {
        accountId: q.accountId ?? { not: null },
        chequeNumber: { not: null },
        account: { countryCode: { in: [...i.countryCodes] } },
        ...(q.search
          ? {
              OR: [
                { chequeNumber: { contains: q.search, mode: "insensitive" } },
                { bankName: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
    const [total, rows] = await this.db.$transaction([
      this.db.cheque.count({ where }),
      this.db.cheque.findMany({
        where,
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    return {
      data: rows.map(chequeDto),
      meta: page(q, offset, total, rows.length),
    };
  }
  async createCheque(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateChequeDto,
  ) {
    this.require(i, permissions.chequesCreate);
    key = requireKey(key);
    if (!new Prisma.Decimal(b.amount).isPositive())
      rule("CHEQUE_AMOUNT_INVALID");
    return this.txs.run(i, async (tx) => {
      await this.account(tx, i, b.accountId);
      if (b.salesOrderId) await this.order(tx, i, b.salesOrderId, b.accountId);
      const requestHash = hash(b),
        replay = await this.replay(
          tx,
          i,
          "post_finance_cheques",
          key,
          requestHash,
        );
      if (replay)
        return {
          data: chequeDto(
            await tx.cheque.findUniqueOrThrow({ where: { id: replay } }),
          ),
        };
      const row = await tx.cheque.create({
        data: {
          sourceSystemCode: b.sourceTypeCode,
          sourceChequeKey: b.sourceChequeKey ?? `MANUAL-${randomUUID()}`,
          accountId: b.accountId,
          chequeNumber: b.chequeNumber,
          bankName: b.bankName ?? null,
          amount: b.amount,
          currencyCode: b.currencyCode,
          issueDate: b.issueDate ? new Date(b.issueDate) : null,
          dueOn: b.dueDate ? new Date(b.dueDate) : null,
          statusCode: "RECEIVED",
          createdByUserId: i.userId,
        },
      });
      await this.remember(
        tx,
        i,
        "post_finance_cheques",
        key,
        requestHash,
        row.id,
      );
      await this.record(tx, i, "CHEQUE_CREATED", "Cheque", row.id, {
        accountId: b.accountId,
      });
      return { data: chequeDto(row) };
    });
  }
  async transitionCheque(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: ChequeTransitionDto,
  ) {
    this.require(i, permissions.chequesManage);
    key = requireKey(key);
    if (!b.reason?.trim()) rule("CHEQUE_TRANSITION_REASON_REQUIRED");
    return this.txs.run(
      i,
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT cheque_id FROM cheques WHERE cheque_id=${id}::uuid FOR UPDATE`,
        );
        const row = await tx.cheque.findUnique({ where: { id } });
        if (!row?.accountId) missing("CHEQUE_NOT_FOUND");
        await this.account(tx, i, row.accountId);
        if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
        const allowed: Record<string, string[]> = {
          RECEIVED: ["DEPOSITED", "CANCELLED"],
          DEPOSITED: ["CLEARED", "BOUNCED", "CANCELLED"],
          BOUNCED: ["DEPOSITED", "CANCELLED"],
          CLEARED: [],
          CANCELLED: [],
        };
        if (!allowed[row.statusCode]?.includes(b.targetStatusCode))
          conflict("CHEQUE_TRANSITION_INVALID");
        const requestHash = hash({ id, b }),
          replay = await this.replay(
            tx,
            i,
            "post_finance_cheque_transition",
            key,
            requestHash,
          );
        if (replay) {
          const old = await tx.cheque.findUniqueOrThrow({
            where: { id: replay },
          });
          return { data: chequeDto(old), etag: etag(old.rowVersion) };
        }
        const now = new Date(),
          updated = await tx.cheque.update({
            where: { id },
            data: {
              statusCode: b.targetStatusCode,
              transitionReason: b.reason!,
              evidenceDocumentId: b.evidenceDocumentId ?? null,
              ...(b.targetStatusCode === "DEPOSITED"
                ? { depositedAt: now }
                : {}),
              ...(b.targetStatusCode === "CLEARED" ? { clearedAt: now } : {}),
              ...(b.targetStatusCode === "BOUNCED" ? { bouncedAt: now } : {}),
              ...(b.targetStatusCode === "CANCELLED"
                ? { cancelledAt: now }
                : {}),
              rowVersion: { increment: 1 },
            },
          });
        await this.remember(
          tx,
          i,
          "post_finance_cheque_transition",
          key,
          requestHash,
          id,
        );
        await this.record(tx, i, "CHEQUE_STATUS_TRANSITIONED", "Cheque", id, {
          from: row.statusCode,
          to: b.targetStatusCode,
          evidenceDocumentId: b.evidenceDocumentId ?? null,
        });
        return { data: chequeDto(updated), etag: etag(updated.rowVersion) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  private require(i: CustomerIdentity, p: string) {
    if (
      !hasWorkspace(i, "FINANCE") ||
      i.deniedPermissions.has(p) ||
      !i.permissions.has(p)
    )
      forbidden();
  }
  private async account(
    tx: TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const r = await tx.account.findFirst({
      where: {
        id,
        countryCode: { in: [...i.countryCodes] },
        recordStatusCode: "ACTIVE",
      },
    });
    if (!r) missing("FINANCE_ACCOUNT_NOT_FOUND");
    return r;
  }
  private async order(
    tx: TransactionClient,
    i: CustomerIdentity,
    id: string,
    accountId: string,
  ) {
    const r = await tx.eRPOrder.findFirst({
      where: { id, accountId, countryCode: { in: [...i.countryCodes] } },
    });
    if (!r) missing("FINANCE_ORDER_NOT_FOUND");
    return r;
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
      workspace: "FINANCE",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "finance-api",
    });
  }
}
function fxDto(r: Prisma.FXRateGetPayload<object>) {
  if (!r.changedByUserId || !r.reason) throw new Error("INVALID_LEGACY_FX_ROW");
  return {
    fxRateId: r.id,
    baseCurrencyCode: r.baseCurrencyCode.trim(),
    quoteCurrencyCode: r.quoteCurrencyCode.trim(),
    rate: r.rate.toString(),
    effectiveAt: r.effectiveFrom.toISOString(),
    sourceCode: r.sourceCode,
    changedByUserId: r.changedByUserId,
    versionNo: r.version,
    supersedesFxRateId: r.supersedesFxRateId,
    reason: r.reason,
    statusCode: r.statusCode,
    createdAt: r.createdAt.toISOString(),
  };
}
function paymentDto(r: Prisma.PaymentGetPayload<object>) {
  if (!r.accountId) throw new Error("INVALID_LEGACY_PAYMENT_ROW");
  return {
    paymentId: r.id,
    sourceSystemId: null,
    sourcePaymentKey: r.sourcePaymentKey,
    accountId: r.accountId,
    salesOrderId: r.erpOrderId,
    paymentDate: r.paymentDate.toISOString().slice(0, 10),
    amount: r.amount.toString(),
    currencyCode: r.currencyCode.trim(),
    paymentMethodCode: r.paymentMethodCode,
    statusCode: r.statusCode,
    rawReference: r.rawReference,
    sourceTypeCode: r.sourceTypeCode,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
    rowVersion: r.rowVersion.toString(),
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidedByUserId: r.voidedByUserId,
    voidReason: r.voidReason,
    correctionOfPaymentId: r.correctionOfPaymentId,
  };
}
function paymentListDto(
  r: Prisma.PaymentGetPayload<object>,
  accountName?: string | null,
) {
  if (!r.accountId) throw new Error("INVALID_LEGACY_PAYMENT_ROW");
  return {
    paymentId: r.id,
    accountId: r.accountId,
    accountName: accountName ?? null,
    salesOrderId: r.erpOrderId,
    paymentDate: r.paymentDate.toISOString().slice(0, 10),
    amount: r.amount.toString(),
    currencyCode: r.currencyCode.trim(),
    paymentMethodCode: r.paymentMethodCode,
    statusCode: r.statusCode,
    sourceTypeCode: r.sourceTypeCode,
    createdAt: r.createdAt.toISOString(),
    rowVersion: r.rowVersion.toString(),
    correctionOfPaymentId: r.correctionOfPaymentId,
  };
}
function chequeDto(r: Prisma.ChequeGetPayload<object>) {
  if (!r.accountId || !r.chequeNumber)
    throw new Error("INVALID_LEGACY_CHEQUE_ROW");
  return {
    chequeId: r.id,
    sourceSystemId: null,
    sourceChequeKey: r.sourceChequeKey,
    accountId: r.accountId,
    salesOrderId: null,
    chequeNumber: r.chequeNumber,
    bankName: r.bankName,
    amount: r.amount.toString(),
    currencyCode: r.currencyCode.trim(),
    issueDate: r.issueDate?.toISOString().slice(0, 10) ?? null,
    dueDate: r.dueOn?.toISOString().slice(0, 10) ?? null,
    statusCode: r.statusCode,
    clearedAt: r.clearedAt?.toISOString() ?? null,
    depositedAt: r.depositedAt?.toISOString() ?? null,
    bouncedAt: r.bouncedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    rowVersion: r.rowVersion.toString(),
  };
}
function page(
  q: FinanceListQuery,
  offset: number,
  total: number,
  count: number,
) {
  return {
    page: Math.floor(offset / q.limit) + 1,
    offset,
    limit: q.limit,
    total,
    hasNext: offset + count < total,
  };
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function requireKey(k: string | undefined) {
  if (!k || k.length < 8 || k.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  return k;
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
