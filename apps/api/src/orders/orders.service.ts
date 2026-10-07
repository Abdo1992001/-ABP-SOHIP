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
import { accountAccessWhere } from "../customer/account-scope.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import { managersOf, notify } from "../support/notify.js";
import { mailStatus } from "../system/system.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  allowedNext,
  canAmend,
  canMove,
  isOrderStatus,
  orderTotals,
  quotationVatRate,
  round2,
  type OrderStatus,
} from "./order-lifecycle.js";
import { agingBucket, isoDate, outstanding } from "./receivable-plan.js";
import {
  dateFromHandover,
  releaseOnCancel,
  resplit,
  writePlan,
} from "./receivable-sync.js";
import type {
  AmendOrderDto,
  CreateOrderDto,
  OrderListQuery,
  OrderTransitionDto,
  SendOrderConfirmationDto,
} from "./orders.dto.js";

const withDetail = {
  account: { select: { canonicalName: true } },
  lines: { orderBy: { lineNo: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
  installments: { orderBy: { installmentNo: "asc" } },
} satisfies Prisma.CustomerOrderInclude;
type OrderRow = Prisma.CustomerOrderGetPayload<{ include: typeof withDetail }>;

/**
 * Customer orders: booked from an accepted quotation, carried to hand-over.
 *
 * The order copies what the customer accepted -- lines, prices, the VAT rate,
 * the payment schedule -- rather than pointing at the quotation, because the
 * quotation is a document that was sent and must not change, and the order
 * is what changes afterwards: a quantity the customer reduces, a delivery
 * date they move. Every such change is an amendment with a reason, kept.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  async list(i: CustomerIdentity, q: OrderListQuery) {
    this.require(i, permissions.salesOrdersView);
    const offset = (q.page - 1) * q.limit;
    const where: Prisma.CustomerOrderWhereInput = {
      ...this.scope(i),
      ...(q.status ? { statusCode: q.status } : {}),
      ...(q.quotationId ? { quotationId: q.quotationId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search
        ? {
            OR: [
              { orderRef: { contains: q.search, mode: "insensitive" } },
              { customerPoNumber: { contains: q.search, mode: "insensitive" } },
              {
                account: {
                  canonicalName: { contains: q.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.customerOrder.count({ where }),
      this.db.customerOrder.findMany({
        where,
        include: { account: { select: { canonicalName: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    const refs = await this.quotationRefs(
      this.db,
      rows.map((row) => row.quotationId),
    );
    return {
      data: rows.map((row) => ({
        ...header(row, refs.get(row.quotationId) ?? null),
        accountName: row.account.canonicalName,
      })),
      meta: {
        page: q.page,
        offset,
        limit: q.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  /**
   * Accepted quotations that have no order yet: what is waiting to be booked.
   * The quotation list does not carry acceptance, and booking from a
   * quotation the customer never accepted is refused anyway, so the screen
   * asks for exactly the ones that can be booked.
   */
  async bookable(i: CustomerIdentity) {
    this.require(i, permissions.salesOrdersCreate);
    const booked = await this.db.customerOrder.findMany({
      where: this.scope(i),
      select: { quotationId: true },
    });
    const rows = await this.db.quotation.findMany({
      where: {
        countryCode: { in: [...i.countryCodes] },
        account: { OR: accountAccessWhere(i, "VIEW") },
        acceptances: { some: { statusCode: "VALID" } },
        id: { notIn: booked.map((row) => row.quotationId) },
      },
      include: {
        account: { select: { canonicalName: true } },
        acceptances: {
          where: { statusCode: "VALID" },
          orderBy: { acceptedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    const late = await this.overdueByAccount(
      this.db,
      rows.map((row) => row.accountId),
    );
    return {
      data: rows.map((row) => ({
        quotationId: row.id,
        quotationRef: row.quotationRef,
        accountId: row.accountId,
        accountName: row.account.canonicalName,
        currencyCode: row.currencyCode?.trim() ?? null,
        totalAmount: row.totalAmount.toString(),
        acceptedAt: row.acceptances[0]?.acceptedAt.toISOString() ?? null,
        // Booking for a customer who is behind on payments needs a manager.
        overdueInstallments: late.get(row.accountId)?.count ?? 0,
        overdueAmount: late.get(row.accountId)?.amount ?? {},
      })),
    };
  }

  async get(i: CustomerIdentity, id: string) {
    this.require(i, permissions.salesOrdersView);
    const row = await this.find(this.db, i, id);
    return {
      data: await this.detail(this.db, i, row),
      etag: etag(row.rowVersion),
    };
  }

  async create(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateOrderDto,
  ) {
    this.require(i, permissions.salesOrdersCreate);
    const idem = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const requestHash = hash(b);
      const replay = await this.replay(
        tx,
        i,
        "post_customer_orders",
        idem,
        requestHash,
      );
      if (replay) return this.result(tx, i, await this.find(tx, i, replay));

      const quotation = await tx.quotation.findFirst({
        where: {
          id: b.quotationId,
          countryCode: { in: [...i.countryCodes] },
          account: { OR: accountAccessWhere(i, "VIEW") },
        },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
      if (!quotation) missing("QUOTATION_NOT_FOUND");
      const accepted = await tx.quotationAcceptance.findFirst({
        where: { quotationId: quotation.id, statusCode: "VALID" },
      });
      // An order is what the customer agreed to; without their acceptance on
      // record there is nothing to book.
      if (!accepted) rule("QUOTATION_NOT_ACCEPTED");
      if (!quotation.currencyCode) rule("QUOTATION_CURRENCY_MISSING");
      if (quotation.lines.length === 0) rule("QUOTATION_HAS_NO_LINES");
      const existing = await tx.customerOrder.findUnique({
        where: { quotationId: quotation.id },
      });
      if (existing) conflict("ORDER_ALREADY_BOOKED");
      // A customer behind on payments does not get more goods on credit
      // without a manager saying so, and why.
      const late = (await this.overdueByAccount(tx, [quotation.accountId])).get(
        quotation.accountId,
      );
      const override = blank(b.creditOverrideReason);
      if (late && late.count > 0) {
        if (override === null) rule("CUSTOMER_HAS_OVERDUE_PAYMENTS");
        if (
          !i.permissions.has(permissions.salesOrdersManage) ||
          i.deniedPermissions.has(permissions.salesOrdersManage)
        )
          throw new ApiProblem({
            status: 403,
            code: "CREDIT_OVERRIDE_NEEDS_MANAGER",
          });
      }

      const productIds = quotation.lines
        .map((line) => line.productId)
        .filter((value): value is string => value !== null);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, skuCode: true, barcode: true },
      });
      const codeOf = (productId: string | null) => {
        const product = products.find((one) => one.id === productId);
        return product?.skuCode ?? product?.barcode ?? null;
      };

      const subtotal = Number(quotation.subtotalAmount);
      const tax = Number(quotation.taxAmount);
      const total = Number(quotation.totalAmount);
      const schedule = isRecord(quotation.paymentScheduleJson)
        ? quotation.paymentScheduleJson
        : null;
      const prose =
        schedule !== null && typeof schedule.prose === "string"
          ? schedule.prose
          : null;

      const order = await tx.customerOrder.create({
        data: {
          quotationId: quotation.id,
          accountId: quotation.accountId,
          opportunityId: quotation.opportunityId,
          countryCode: quotation.countryCode,
          currencyCode: quotation.currencyCode,
          statusCode: "DRAFT",
          customerPoNumber:
            blank(b.customerPoNumber) ?? quotation.customerPoNumber,
          requestedDeliveryDate: b.requestedDeliveryDate
            ? new Date(b.requestedDeliveryDate)
            : null,
          notes: blank(b.notes),
          subtotalAmount: quotation.subtotalAmount,
          adjustmentAmount: new Prisma.Decimal(round2(total - tax - subtotal)),
          vatRate: new Prisma.Decimal(quotationVatRate(subtotal, tax, total)),
          taxAmount: quotation.taxAmount,
          totalAmount: quotation.totalAmount,
          ...(schedule === null ? {} : { paymentScheduleJsonb: schedule }),
          paymentTermsText: prose ?? quotation.paymentTermsSnapshot,
          ownerUserId: quotation.ownerUserId,
          createdByUserId: i.userId,
          lines: {
            create: quotation.lines.map((line) => ({
              quotationLineId: line.id,
              lineNo: line.lineNo,
              productId: line.productId,
              itemCode: codeOf(line.productId),
              description: line.description,
              quantity: line.qty,
              unitCode: line.unitCode,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              lineTotal: line.lineTotal,
              weightKg: weightOf(line.priceSnapshot),
            })),
          },
          events: {
            create: {
              eventCode: "BOOKED",
              toStatusCode: "DRAFT",
              actorUserId: i.userId,
              details: {
                quotationRef: quotation.quotationRef,
                acceptanceId: accepted.id,
                ...(late && late.count > 0
                  ? {
                      creditOverride: {
                        reason: override,
                        overdueInstallments: late.count,
                        overdueAmount: late.amount,
                      },
                    }
                  : {}),
              },
            },
          },
        },
      });
      await this.remember(
        tx,
        i,
        "post_customer_orders",
        idem,
        requestHash,
        order.id,
      );
      await this.record(tx, i, "CUSTOMER_ORDER_BOOKED", order.id, {
        quotationId: quotation.id,
        totalAmount: quotation.totalAmount.toString(),
      });
      // Booked although the customer is late paying: the salesperson who
      // owns the customer and their manager hear about it now, with why.
      if (late && late.count > 0) {
        const account = await tx.account.findUnique({
          where: { id: quotation.accountId },
          select: { canonicalName: true },
        });
        const owed = Object.entries(late.amount)
          .map(([currency, amount]) => `${String(amount)} ${currency}`)
          .join(" + ");
        const recipients = new Set([
          quotation.ownerUserId,
          ...(await managersOf(tx, quotation.ownerUserId)),
        ]);
        recipients.delete(i.userId);
        for (const recipientUserId of recipients)
          await notify(tx, {
            recipientUserId,
            typeCode: "CREDIT_OVERRIDE",
            titleSafe:
              `Order ${order.orderRef} booked for ${account?.canonicalName ?? "a customer"} with payments overdue`.slice(
                0,
                200,
              ),
            bodySafe:
              `${String(late.count)} overdue installment${late.count === 1 ? "" : "s"} (${owed}). Reason: ${override ?? ""}`.slice(
                0,
                480,
              ),
            resourceTypeCode: "CUSTOMER_ORDER",
            resourceId: order.id,
          });
      }
      return this.result(tx, i, await this.find(tx, i, order.id));
    });
  }

  /**
   * Email the customer a confirmation of the order: what they ordered, at
   * what price, on what terms, delivered when. The worker renders the PDF and
   * sends it from the company mailbox; replies reach the salesperson.
   */
  async sendConfirmation(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: SendOrderConfirmationDto,
  ) {
    this.require(i, permissions.salesOrdersView);
    const idem = requireKey(key);
    if (!mailStatus().configured) rule("EMAIL_NOT_CONFIGURED");
    return this.txs.run(i, async (tx) => {
      const requestHash = hash({ id, b });
      const op = "post_customer_orders_confirmation_emails";
      const replay = await this.replay(tx, i, op, idem, requestHash);
      if (replay) return this.result(tx, i, await this.find(tx, i, replay));
      const row = await this.find(tx, i, id);
      if (
        !["CONFIRMED", "IN_PRODUCTION", "READY", "HANDED_OVER"].includes(
          row.statusCode,
        )
      )
        rule("ORDER_NOT_CONFIRMED");
      const recipients = b.recipients.map((r) => ({
        contactId: r.contactId ?? null,
        name: blank(r.name),
        email: r.email.trim().toLowerCase(),
      }));
      const job = await tx.durableJob.create({
        data: {
          type: "ORDER_CONFIRMATION_SEND",
          status: "PENDING",
          payload: {
            customerOrderId: id,
            recipients,
            message: blank(b.message),
            ccSelf: b.ccSelf === true,
            languageCode: b.languageCode ?? "en",
            createdByUserId: i.userId,
          },
          traceId: i.traceId,
          correlationId: i.correlationId,
          idempotencyKey: `order-confirmation:${idem}`,
          sourceType: "CUSTOMER_ORDER",
          sourceId: id,
        },
      });
      await tx.customerOrderEvent.create({
        data: {
          customerOrderId: id,
          eventCode: "CONFIRMATION_SENT",
          fromStatusCode: row.statusCode,
          toStatusCode: row.statusCode,
          note: recipients.map((r) => r.email).join(", "),
          details: { jobId: job.id, recipients },
          actorUserId: i.userId,
        },
      });
      await this.remember(tx, i, op, idem, requestHash, id);
      await this.record(tx, i, "CUSTOMER_ORDER_CONFIRMATION_SENT", id, {
        recipients: recipients.map((r) => r.email),
        jobId: job.id,
      });
      return this.result(tx, i, await this.find(tx, i, id));
    });
  }

  async amend(i: CustomerIdentity, id: string, b: AmendOrderDto) {
    this.require(i, permissions.salesOrdersManage);
    return this.txs.run(i, async (tx) => {
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      const status = statusOf(row.statusCode);
      if (!canAmend(status)) rule("ORDER_NOT_AMENDABLE");
      if (blank(b.reason) === null) rule("AMENDMENT_REASON_REQUIRED");

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const header: Prisma.CustomerOrderUpdateInput = {};
      const text = (
        field: "customerPoNumber" | "deliveryTerms" | "deliveryPoint" | "notes",
        value: string | null | undefined,
      ) => {
        if (value === undefined) return;
        const next = blank(value);
        if (next === row[field]) return;
        changes[field] = { from: row[field], to: next };
        header[field] = next;
      };
      text("customerPoNumber", b.customerPoNumber);
      text("deliveryTerms", b.deliveryTerms);
      text("deliveryPoint", b.deliveryPoint);
      text("notes", b.notes);
      if (b.requestedDeliveryDate !== undefined) {
        const next = b.requestedDeliveryDate
          ? new Date(b.requestedDeliveryDate)
          : null;
        const before =
          row.requestedDeliveryDate?.toISOString().slice(0, 10) ?? null;
        const after = next?.toISOString().slice(0, 10) ?? null;
        if (before !== after) {
          changes.requestedDeliveryDate = { from: before, to: after };
          header.requestedDeliveryDate = next;
        }
      }

      let lineTotals = row.lines.map((line) => Number(line.lineTotal));
      for (const change of b.lines ?? []) {
        const index = row.lines.findIndex((line) => line.id === change.lineId);
        const line = row.lines[index];
        if (line === undefined) rule("ORDER_LINE_NOT_FOUND");
        const quantity = Number(change.quantity);
        if (!(quantity > 0)) rule("ORDER_LINE_QUANTITY_INVALID");
        if (quantity === Number(line.quantity)) continue;
        const lineTotal = round2(
          Math.max(
            0,
            quantity * Number(line.unitPrice) - Number(line.discountAmount),
          ),
        );
        await tx.customerOrderLine.update({
          where: { id: line.id },
          data: {
            quantity: new Prisma.Decimal(change.quantity),
            lineTotal: new Prisma.Decimal(lineTotal),
            weightKg:
              line.weightKg === null
                ? null
                : new Prisma.Decimal(
                    round3(
                      (Number(line.weightKg) / Number(line.quantity)) *
                        quantity,
                    ),
                  ),
          },
        });
        changes[`line ${String(line.lineNo)}`] = {
          from: line.quantity.toString(),
          to: change.quantity,
        };
        lineTotals = lineTotals.map((value, at) =>
          at === index ? lineTotal : value,
        );
      }
      if (Object.keys(changes).length === 0) rule("AMENDMENT_CHANGES_NOTHING");

      const money = orderTotals(
        lineTotals,
        Number(row.adjustmentAmount),
        Number(row.vatRate),
      );
      const updated = await tx.customerOrder.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data: {
          ...(header as Prisma.CustomerOrderUpdateManyMutationInput),
          subtotalAmount: new Prisma.Decimal(money.subtotal),
          taxAmount: new Prisma.Decimal(money.tax),
          totalAmount: new Prisma.Decimal(money.total),
          amendmentNo: { increment: 1 },
          rowVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) precondition();
      if (money.total.toFixed(2) !== Number(row.totalAmount).toFixed(2))
        await resplit(tx, id, money.total.toFixed(2));
      await tx.customerOrderEvent.create({
        data: {
          customerOrderId: id,
          eventCode: "AMENDED",
          fromStatusCode: row.statusCode,
          toStatusCode: row.statusCode,
          note: blank(b.reason),
          details: {
            amendmentNo: row.amendmentNo + 1,
            changes,
            totalBefore: row.totalAmount.toString(),
            totalAfter: money.total.toFixed(2),
          } as Prisma.InputJsonValue,
          actorUserId: i.userId,
        },
      });
      await this.record(tx, i, "CUSTOMER_ORDER_AMENDED", id, {
        amendmentNo: row.amendmentNo + 1,
        changes: Object.keys(changes),
      });
      return this.result(tx, i, await this.find(tx, i, id));
    });
  }

  async transition(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: OrderTransitionDto,
  ) {
    this.require(i, permissions.salesOrdersManage);
    const idem = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const requestHash = hash({ id, b });
      const op = "post_customer_orders_transitions";
      const replay = await this.replay(tx, i, op, idem, requestHash);
      if (replay) return this.result(tx, i, await this.find(tx, i, replay));
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      const from = statusOf(row.statusCode);
      if (!isOrderStatus(b.targetStatusCode)) rule("ORDER_STATUS_INVALID");
      const to = b.targetStatusCode;
      if (!canMove(from, to)) rule("ORDER_TRANSITION_INVALID");
      if (to === "CANCELLED" && blank(b.reason) === null)
        rule("CANCEL_REASON_REQUIRED");

      const now = new Date();
      const stamp: Prisma.CustomerOrderUpdateManyMutationInput =
        to === "CONFIRMED"
          ? { confirmedAt: now, confirmedByUserId: i.userId }
          : to === "HANDED_OVER"
            ? { handedOverAt: now, handedOverByUserId: i.userId }
            : to === "CLOSED"
              ? { closedAt: now, closedByUserId: i.userId }
              : to === "CANCELLED"
                ? {
                    cancelledAt: now,
                    cancelledByUserId: i.userId,
                    cancelReason: blank(b.reason),
                  }
                : {};
      const updated = await tx.customerOrder.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data: {
          ...stamp,
          statusCode: to,
          rowVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) precondition();
      // The receivable plan follows the order: written when the customer's
      // commitment is confirmed, dated when the clock of "after delivery"
      // starts, released when the order is cancelled.
      if (to === "CONFIRMED") await writePlan(tx, row, now);
      if (to === "HANDED_OVER") await dateFromHandover(tx, id, now);
      if (to === "CANCELLED") await releaseOnCancel(tx, id);
      await tx.customerOrderEvent.create({
        data: {
          customerOrderId: id,
          eventCode: "STATUS_CHANGED",
          fromStatusCode: from,
          toStatusCode: to,
          note: blank(b.note) ?? blank(b.reason),
          actorUserId: i.userId,
        },
      });
      await this.remember(tx, i, op, idem, requestHash, id);
      await this.record(tx, i, "CUSTOMER_ORDER_STATUS_CHANGED", id, {
        from,
        to,
      });
      return this.result(tx, i, await this.find(tx, i, id));
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Installments past due and unpaid, per account: how many and how much. */
  private async overdueByAccount(
    db: DatabaseClient | TransactionClient,
    accountIds: string[],
  ) {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const rows = await db.receivableInstallment.findMany({
      where: {
        accountId: { in: [...new Set(accountIds)] },
        statusCode: { in: ["OPEN", "PARTIAL"] },
        dueDate: { lt: today },
      },
      select: {
        accountId: true,
        currencyCode: true,
        amount: true,
        collectedAmount: true,
        writtenOffAmount: true,
      },
    });
    const out = new Map<
      string,
      { count: number; amount: Record<string, number> }
    >();
    for (const row of rows) {
      const entry = out.get(row.accountId) ?? { count: 0, amount: {} };
      const left =
        Number(row.amount) -
        Number(row.collectedAmount) -
        Number(row.writtenOffAmount);
      if (left <= 0) continue;
      entry.count += 1;
      const currency = row.currencyCode.trim();
      entry.amount[currency] =
        Math.round(((entry.amount[currency] ?? 0) + left) * 100) / 100;
      out.set(row.accountId, entry);
    }
    return out;
  }

  private scope(i: CustomerIdentity): Prisma.CustomerOrderWhereInput {
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
    const row = await db.customerOrder.findFirst({
      where: { id, ...this.scope(i) },
      include: withDetail,
    });
    if (!row) missing("CUSTOMER_ORDER_NOT_FOUND");
    return row;
  }

  private async result(
    tx: TransactionClient,
    i: CustomerIdentity,
    row: OrderRow,
  ) {
    return { data: await this.detail(tx, i, row), etag: etag(row.rowVersion) };
  }

  private async detail(
    db: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    row: OrderRow,
  ) {
    const refs = await this.quotationRefs(db, [row.quotationId]);
    const workOrders = await db.workOrder.findMany({
      where: { customerOrderId: row.id },
      orderBy: [{ plannedStartDate: "asc" }, { id: "asc" }],
    });
    const shipments = await db.shipment.findMany({
      where: { customerOrderId: row.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const users = await db.appUser.findMany({
      where: {
        id: {
          in: [
            row.ownerUserId,
            ...row.events.map((event) => event.actorUserId),
          ],
        },
      },
      select: { id: true, displayName: true },
    });
    const nameOf = (userId: string) =>
      users.find((user) => user.id === userId)?.displayName ?? null;
    const manage =
      i.permissions.has(permissions.salesOrdersManage) &&
      !i.deniedPermissions.has(permissions.salesOrdersManage);
    const status = statusOf(row.statusCode);
    return {
      ...header(row, refs.get(row.quotationId) ?? null),
      accountName: row.account.canonicalName,
      ownerName: nameOf(row.ownerUserId),
      deliveryTerms: row.deliveryTerms,
      deliveryPoint: row.deliveryPoint,
      notes: row.notes,
      adjustmentAmount: row.adjustmentAmount.toString(),
      vatRate: row.vatRate.toString(),
      paymentTermsText: row.paymentTermsText,
      paymentSchedule: row.paymentScheduleJsonb ?? null,
      confirmedAt: iso(row.confirmedAt),
      handedOverAt: iso(row.handedOverAt),
      closedAt: iso(row.closedAt),
      cancelledAt: iso(row.cancelledAt),
      cancelReason: row.cancelReason,
      canAmend: manage && canAmend(status),
      allowedTransitions: manage ? [...allowedNext(status)] : [],
      lines: row.lines.map((line) => ({
        lineId: line.id,
        lineNo: line.lineNo,
        productId: line.productId,
        itemCode: line.itemCode,
        description: line.description,
        quantity: line.quantity.toString(),
        unitCode: line.unitCode,
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        lineTotal: line.lineTotal.toString(),
        weightKg: line.weightKg?.toString() ?? null,
      })),
      installments: row.installments.map((one) => {
        const owed = outstanding(
          one.amount.toString(),
          one.collectedAmount.toString(),
          one.writtenOffAmount.toString(),
        );
        const dueDate = one.dueDate?.toISOString().slice(0, 10) ?? null;
        return {
          receivableInstallmentId: one.id,
          installmentNo: one.installmentNo,
          label: one.label,
          stageCode: one.stageCode,
          dueBasisCode: one.dueBasisCode,
          daysAfter: one.daysAfter,
          dueDate,
          amount: one.amount.toString(),
          collectedAmount: one.collectedAmount.toString(),
          writtenOffAmount: one.writtenOffAmount.toString(),
          outstandingAmount: one.statusCode === "CANCELLED" ? "0.00" : owed,
          methodCode: one.methodCode,
          statusCode: one.statusCode,
          agingBucket:
            one.statusCode === "CANCELLED"
              ? "SETTLED"
              : agingBucket({
                  dueDate,
                  outstanding: owed,
                  today: isoDate(new Date()),
                }),
        };
      }),
      // What the factory is doing about it.
      workOrders: workOrders.map((one) => ({
        workOrderId: one.id,
        workOrderRef: one.workOrderRef,
        statusCode: one.statusCode,
        productionLineCode: one.productionLineCode,
        quantityPlanned: one.quantityPlanned.toString(),
        quantityProduced: one.quantityProduced.toString(),
        plannedStartDate: one.plannedStartDate.toISOString().slice(0, 10),
        plannedEndDate: one.plannedEndDate.toISOString().slice(0, 10),
        qcResultCode: one.qcResultCode,
      })),
      // How the goods are getting to the customer.
      shipments: shipments.map((one) => ({
        shipmentId: one.id,
        shipmentRef: one.shipmentRef,
        transportModeCode: one.transportModeCode,
        milestoneCode: one.milestoneCode,
        plannedDispatchDate:
          one.plannedDispatchDate?.toISOString().slice(0, 10) ?? null,
        expectedDeliveryDate:
          one.expectedDeliveryDate?.toISOString().slice(0, 10) ?? null,
        deliveredAt: one.deliveredAt?.toISOString() ?? null,
        deliveryConditionCode: one.deliveryConditionCode,
        podReceivedAt: one.podReceivedAt?.toISOString() ?? null,
      })),
      events: row.events.map((event) => ({
        eventId: event.id,
        eventCode: event.eventCode,
        fromStatusCode: event.fromStatusCode,
        toStatusCode: event.toStatusCode,
        note: event.note,
        details: event.details ?? null,
        actorName: nameOf(event.actorUserId),
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private async quotationRefs(
    db: DatabaseClient | TransactionClient,
    ids: string[],
  ) {
    const rows = await db.quotation.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, quotationRef: true },
    });
    return new Map(rows.map((row) => [row.id, row.quotationRef]));
  }

  private require(i: CustomerIdentity, p: string) {
    if (
      !hasWorkspace(i, "SALES") &&
      !hasWorkspace(i, "FINANCE") &&
      !hasWorkspace(i, "LOGISTICS")
    )
      forbidden();
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
      resourceType: "CustomerOrder",
      resourceId: id,
      workspace: "SALES",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "orders-api",
    });
  }
}

function header(
  row: Prisma.CustomerOrderGetPayload<object>,
  quotationRef: string | null,
) {
  return {
    customerOrderId: row.id,
    orderRef: row.orderRef,
    quotationId: row.quotationId,
    quotationRef,
    accountId: row.accountId,
    opportunityId: row.opportunityId,
    erpOrderId: row.erpOrderId,
    countryCode: row.countryCode.trim(),
    currencyCode: row.currencyCode.trim(),
    statusCode: row.statusCode,
    customerPoNumber: row.customerPoNumber,
    requestedDeliveryDate:
      row.requestedDeliveryDate?.toISOString().slice(0, 10) ?? null,
    subtotalAmount: row.subtotalAmount.toString(),
    taxAmount: row.taxAmount.toString(),
    totalAmount: row.totalAmount.toString(),
    amendmentNo: row.amendmentNo,
    rowVersion: row.rowVersion.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function statusOf(code: string): OrderStatus {
  if (!isOrderStatus(code)) rule("ORDER_STATUS_INVALID");
  return code;
}
function weightOf(snapshot: Prisma.JsonValue): Prisma.Decimal | null {
  if (!isRecord(snapshot)) return null;
  const value = Number(snapshot.totalWeightKg);
  return Number.isFinite(value) && value > 0
    ? new Prisma.Decimal(round3(value))
    : null;
}
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function blank(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}
function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
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
