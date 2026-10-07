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
import { accountAccessWhere } from "../customer/account-scope.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  AGING_BUCKETS,
  addDays,
  addMoney,
  agingBucket,
  compareMoney,
  daysBetween,
  isoDate,
  outstanding,
  settleStatus,
  type AgingBucket,
} from "./receivable-plan.js";
import type {
  ReceivableListQuery,
  RecordCollectionDto,
  WriteOffDto,
} from "./receivables.dto.js";

const OWED = ["OPEN", "PARTIAL"];
const withContext = {
  order: { select: { orderRef: true, erpOrderId: true, statusCode: true } },
  account: { select: { canonicalName: true } },
  receipts: { orderBy: { receivedOn: "asc" } },
} satisfies Prisma.ReceivableInstallmentInclude;
type InstallmentRow = Prisma.ReceivableInstallmentGetPayload<{
  include: typeof withContext;
}>;

/**
 * Receivables: what customers owe on their orders, when it fell due, and
 * what has come in against it.
 *
 * Amounts are reported per currency and never added across currencies -- an
 * EGP and a USD balance summed together is a number in no currency at all.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  async list(i: CustomerIdentity, q: ReceivableListQuery) {
    this.require(i, permissions.paymentsView);
    const today = new Date(isoDate(new Date()));
    const soon = new Date(addDays(isoDate(today), 30));
    const view: Prisma.ReceivableInstallmentWhereInput =
      q.view === "ALL"
        ? {}
        : q.view === "SETTLED"
          ? { statusCode: { notIn: OWED } }
          : q.view === "OVERDUE"
            ? { statusCode: { in: OWED }, dueDate: { lt: today } }
            : q.view === "DUE_SOON"
              ? { statusCode: { in: OWED }, dueDate: { gte: today, lte: soon } }
              : q.view === "NOT_SCHEDULED"
                ? { statusCode: { in: OWED }, dueDate: null }
                : { statusCode: { in: OWED } };
    const where: Prisma.ReceivableInstallmentWhereInput = {
      ...this.scope(i),
      ...view,
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.customerOrderId ? { customerOrderId: q.customerOrderId } : {}),
      ...(q.search
        ? {
            OR: [
              {
                order: {
                  orderRef: { contains: q.search, mode: "insensitive" },
                },
              },
              {
                account: {
                  canonicalName: { contains: q.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const offset = (q.page - 1) * q.limit;
    const [total, rows] = await this.db.$transaction([
      this.db.receivableInstallment.count({ where }),
      this.db.receivableInstallment.findMany({
        where,
        include: withContext,
        orderBy: [
          { dueDate: { sort: "asc", nulls: "last" } },
          { installmentNo: "asc" },
          { id: "asc" },
        ],
        skip: offset,
        take: q.limit,
      }),
    ]);
    return {
      data: rows.map((row) => dto(row)),
      meta: {
        page: q.page,
        offset,
        limit: q.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  /** The aging picture, per currency, plus who owes the most that is late. */
  async summary(i: CustomerIdentity) {
    this.require(i, permissions.paymentsView);
    const today = isoDate(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [owed, receipts] = await Promise.all([
      this.db.receivableInstallment.findMany({
        where: { ...this.scope(i), statusCode: { in: OWED } },
        include: { account: { select: { canonicalName: true } } },
        take: 10_000,
      }),
      this.db.receivableReceipt.findMany({
        where: {
          receivedOn: { gte: new Date(monthStart) },
          installment: this.scope(i),
        },
        include: { installment: { select: { currencyCode: true } } },
        take: 10_000,
      }),
    ]);
    type Totals = {
      currencyCode: string;
      outstandingAmount: string;
      overdueAmount: string;
      dueIn30DaysAmount: string;
      notScheduledAmount: string;
      collectedThisMonthAmount: string;
      overdueCount: number;
      buckets: Record<AgingBucket, string>;
    };
    const byCurrency = new Map<string, Totals>();
    const totalsFor = (currency: string): Totals => {
      const key = currency.trim();
      let found = byCurrency.get(key);
      if (found === undefined) {
        found = {
          currencyCode: key,
          outstandingAmount: "0.00",
          overdueAmount: "0.00",
          dueIn30DaysAmount: "0.00",
          notScheduledAmount: "0.00",
          collectedThisMonthAmount: "0.00",
          overdueCount: 0,
          buckets: Object.fromEntries(
            AGING_BUCKETS.map((bucket) => [bucket, "0.00"]),
          ) as Record<AgingBucket, string>,
        };
        byCurrency.set(key, found);
      }
      return found;
    };
    const late = new Map<
      string,
      {
        accountId: string;
        accountName: string;
        currencyCode: string;
        overdueAmount: string;
        oldestDueDate: string;
      }
    >();
    for (const row of owed) {
      const left = outstanding(
        row.amount.toString(),
        row.collectedAmount.toString(),
        row.writtenOffAmount.toString(),
      );
      const due = row.dueDate ? isoDate(row.dueDate) : null;
      const bucket = agingBucket({ dueDate: due, outstanding: left, today });
      if (bucket === "SETTLED") continue;
      const totals = totalsFor(row.currencyCode);
      totals.outstandingAmount = addMoney(totals.outstandingAmount, left);
      totals.buckets[bucket] = addMoney(totals.buckets[bucket], left);
      if (bucket === "NOT_SCHEDULED")
        totals.notScheduledAmount = addMoney(totals.notScheduledAmount, left);
      if (bucket === "NOT_DUE" && due !== null && daysBetween(today, due) <= 30)
        totals.dueIn30DaysAmount = addMoney(totals.dueIn30DaysAmount, left);
      if (bucket.startsWith("OVERDUE") && due !== null) {
        totals.overdueAmount = addMoney(totals.overdueAmount, left);
        totals.overdueCount += 1;
        const key = `${row.accountId}|${totals.currencyCode}`;
        const seen = late.get(key);
        late.set(key, {
          accountId: row.accountId,
          accountName: row.account.canonicalName,
          currencyCode: totals.currencyCode,
          overdueAmount: addMoney(seen?.overdueAmount ?? "0", left),
          oldestDueDate:
            seen === undefined || due < seen.oldestDueDate
              ? due
              : seen.oldestDueDate,
        });
      }
    }
    for (const receipt of receipts) {
      const totals = totalsFor(receipt.installment.currencyCode);
      totals.collectedThisMonthAmount = addMoney(
        totals.collectedThisMonthAmount,
        receipt.amount.toString(),
      );
    }
    return {
      data: {
        asOf: today,
        currencies: [...byCurrency.values()].sort((a, b) =>
          compareMoney(b.outstandingAmount, a.outstandingAmount),
        ),
        topOverdueAccounts: [...late.values()]
          .sort((a, b) => compareMoney(b.overdueAmount, a.overdueAmount))
          .slice(0, 8)
          .map((one) => ({
            ...one,
            daysOverdue: daysBetween(one.oldestDueDate, today),
          })),
      },
    };
  }

  async collect(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: RecordCollectionDto,
  ) {
    this.require(i, permissions.paymentsCreate);
    const idem = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const op = "post_receivables_collections";
      const requestHash = hash({ id, b });
      const replay = await this.replay(tx, i, op, idem, requestHash);
      if (replay) return { data: dto(await this.find(tx, i, id)) };
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      if (!OWED.includes(row.statusCode)) rule("RECEIVABLE_NOT_OPEN");
      const left = outstanding(
        row.amount.toString(),
        row.collectedAmount.toString(),
        row.writtenOffAmount.toString(),
      );
      if (compareMoney(b.amount, "0") <= 0) rule("COLLECTION_AMOUNT_INVALID");
      if (compareMoney(b.amount, left) > 0)
        rule("COLLECTION_EXCEEDS_OUTSTANDING");
      // "Today" is the person's own date, which in Cairo is a day ahead of UTC
      // for the first hours after midnight. Only a date that is not yet today
      // anywhere -- past UTC+14 -- is genuinely in the future.
      if (
        b.receivedOn.slice(0, 10) >
        isoDate(new Date(Date.now() + 14 * 3_600_000))
      )
        rule("COLLECTION_DATE_IN_FUTURE");

      const receiptId = randomUUID();
      const reference = blank(b.reference);
      const payment = await tx.payment.create({
        data: {
          sourceSystemCode: "MANUAL",
          sourcePaymentKey: `RCV-${receiptId}`,
          accountId: row.accountId,
          erpOrderId: row.order.erpOrderId,
          paymentDate: new Date(b.receivedOn),
          amount: new Prisma.Decimal(b.amount),
          currencyCode: row.currencyCode,
          paymentMethodCode: b.methodCode,
          statusCode: "ACTIVE",
          rawReference: reference ?? `${row.order.orderRef} / ${row.label}`,
          sourceTypeCode: "MANUAL",
          createdByUserId: i.userId,
        },
      });
      // A cheque is money that has not cleared yet: it goes on the cheques
      // register too, where deposit, clearing and bouncing are tracked.
      if (b.methodCode === "CHEQUE")
        await tx.cheque.create({
          data: {
            sourceSystemCode: "MANUAL",
            sourceChequeKey: `RCV-${receiptId}`,
            paymentId: payment.id,
            accountId: row.accountId,
            chequeNumber: reference,
            amount: new Prisma.Decimal(b.amount),
            currencyCode: row.currencyCode,
            dueOn: row.dueDate ?? new Date(b.receivedOn),
            issueDate: new Date(b.receivedOn),
            statusCode: "RECEIVED",
            createdByUserId: i.userId,
          },
        });
      await tx.receivableReceipt.create({
        data: {
          id: receiptId,
          installmentId: row.id,
          paymentId: payment.id,
          amount: new Prisma.Decimal(b.amount),
          receivedOn: new Date(b.receivedOn),
          methodCode: b.methodCode,
          reference,
          note: blank(b.note),
          recordedByUserId: i.userId,
        },
      });
      const collected = addMoney(row.collectedAmount.toString(), b.amount);
      const updated = await tx.receivableInstallment.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data: {
          collectedAmount: new Prisma.Decimal(collected),
          statusCode: settleStatus(
            row.amount.toString(),
            collected,
            row.writtenOffAmount.toString(),
          ),
          rowVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) precondition();
      await this.remember(tx, i, op, idem, requestHash, id);
      await this.record(tx, i, "RECEIVABLE_COLLECTED", id, {
        orderRef: row.order.orderRef,
        amount: b.amount,
        methodCode: b.methodCode,
        paymentId: payment.id,
      });
      return { data: dto(await this.find(tx, i, id)) };
    });
  }

  async writeOff(i: CustomerIdentity, id: string, b: WriteOffDto) {
    this.require(i, permissions.paymentsAllocate);
    return this.txs.run(i, async (tx) => {
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      if (!OWED.includes(row.statusCode)) rule("RECEIVABLE_NOT_OPEN");
      const reason = blank(b.reason);
      if (reason === null || reason.length < 3)
        rule("WRITE_OFF_REASON_REQUIRED");
      const left = outstanding(
        row.amount.toString(),
        row.collectedAmount.toString(),
        row.writtenOffAmount.toString(),
      );
      const off = addMoney(row.writtenOffAmount.toString(), left);
      const updated = await tx.receivableInstallment.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data: {
          writtenOffAmount: new Prisma.Decimal(off),
          writeOffReason: reason,
          writtenOffAt: new Date(),
          writtenOffByUserId: i.userId,
          statusCode: settleStatus(
            row.amount.toString(),
            row.collectedAmount.toString(),
            off,
          ),
          rowVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) precondition();
      await this.record(tx, i, "RECEIVABLE_WRITTEN_OFF", id, {
        orderRef: row.order.orderRef,
        amount: left,
      });
      return { data: dto(await this.find(tx, i, id)) };
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private scope(i: CustomerIdentity): Prisma.ReceivableInstallmentWhereInput {
    return {
      countryCode: { in: [...i.countryCodes] },
      account: { OR: accountAccessWhere(i, "VIEW") },
    };
  }

  private async find(
    db: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const row = await db.receivableInstallment.findFirst({
      where: { id, ...this.scope(i) },
      include: withContext,
    });
    if (!row)
      throw new ApiProblem({ status: 404, code: "RECEIVABLE_NOT_FOUND" });
    return row;
  }

  private require(i: CustomerIdentity, p: string) {
    if (!hasWorkspace(i, "FINANCE") && !hasWorkspace(i, "SALES")) forbidden();
    if (i.deniedPermissions.has(p) || !i.permissions.has(p)) forbidden();
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
        if (r && r.requestHash !== h)
          throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
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
      resourceType: "ReceivableInstallment",
      resourceId: id,
      workspace: "FINANCE",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "receivables-api",
    });
  }
}

function dto(row: InstallmentRow) {
  const left =
    row.statusCode === "CANCELLED"
      ? "0.00"
      : outstanding(
          row.amount.toString(),
          row.collectedAmount.toString(),
          row.writtenOffAmount.toString(),
        );
  const dueDate = row.dueDate ? isoDate(row.dueDate) : null;
  const today = isoDate(new Date());
  return {
    receivableInstallmentId: row.id,
    customerOrderId: row.customerOrderId,
    orderRef: row.order.orderRef,
    orderStatusCode: row.order.statusCode,
    accountId: row.accountId,
    accountName: row.account.canonicalName,
    countryCode: row.countryCode.trim(),
    currencyCode: row.currencyCode.trim(),
    installmentNo: row.installmentNo,
    label: row.label,
    stageCode: row.stageCode,
    dueBasisCode: row.dueBasisCode,
    daysAfter: row.daysAfter,
    dueDate,
    daysOverdue:
      dueDate !== null && compareMoney(left, "0") > 0
        ? Math.max(0, daysBetween(dueDate, today))
        : 0,
    amount: row.amount.toString(),
    collectedAmount: row.collectedAmount.toString(),
    writtenOffAmount: row.writtenOffAmount.toString(),
    outstandingAmount: left,
    methodCode: row.methodCode,
    statusCode: row.statusCode,
    agingBucket: agingBucket({ dueDate, outstanding: left, today }),
    writeOffReason: row.writeOffReason,
    rowVersion: row.rowVersion.toString(),
    receipts: row.receipts.map((receipt) => ({
      receiptId: receipt.id,
      paymentId: receipt.paymentId,
      amount: receipt.amount.toString(),
      receivedOn: isoDate(receipt.receivedOn),
      methodCode: receipt.methodCode,
      reference: receipt.reference,
      note: receipt.note,
    })),
  };
}

function blank(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function requireKey(k: string | undefined) {
  if (!k || k.length < 8 || k.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  return k;
}
function forbidden(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "ROW_VERSION_MISMATCH" });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
