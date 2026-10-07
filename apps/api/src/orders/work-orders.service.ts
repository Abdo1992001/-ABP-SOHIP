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
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  allowedWorkOrderMoves,
  canMoveWorkOrder,
  canReschedule,
  moveRequirements,
  orderStatusFromWork,
  plannedEnd,
  productionDays,
  scheduleRisk,
} from "./work-order-flow.js";
import type {
  CreateWorkOrderDto,
  ProductionScheduleQuery,
  RescheduleWorkOrderDto,
  WorkOrderListQuery,
  WorkOrderTransitionDto,
} from "./work-orders.dto.js";

const withContext = {
  order: {
    select: {
      orderRef: true,
      statusCode: true,
      requestedDeliveryDate: true,
      quotationId: true,
    },
  },
  account: { select: { canonicalName: true } },
} satisfies Prisma.WorkOrderInclude;
type WorkOrderRow = Prisma.WorkOrderGetPayload<{ include: typeof withContext }>;

/** Orders that can be produced: confirmed and not yet finished with. */
const PRODUCIBLE = ["CONFIRMED", "IN_PRODUCTION"];

/**
 * Work orders and the production schedule.
 *
 * Operations plans an order's boards onto a line; the run's length comes from
 * the board category's capacity rate. The order follows the work: it goes
 * into production with the first run started and becomes ready with the last
 * run completed and checked -- so sales sees the factory's progress on the
 * order without asking for it.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  async list(i: CustomerIdentity, q: WorkOrderListQuery) {
    this.require(i, permissions.workOrdersView);
    const offset = (q.page - 1) * q.limit;
    const where: Prisma.WorkOrderWhereInput = {
      ...this.scope(i),
      ...(q.status ? { statusCode: q.status } : {}),
      ...(q.customerOrderId ? { customerOrderId: q.customerOrderId } : {}),
      ...(q.productionLineCode
        ? { productionLineCode: q.productionLineCode }
        : {}),
      ...(q.search
        ? {
            OR: [
              { workOrderRef: { contains: q.search, mode: "insensitive" } },
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
    const [total, rows] = await this.db.$transaction([
      this.db.workOrder.count({ where }),
      this.db.workOrder.findMany({
        where,
        include: withContext,
        orderBy: [{ plannedStartDate: "asc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    const today = isoDay(new Date());
    return {
      data: rows.map((row) => dto(row, today)),
      meta: {
        page: q.page,
        offset,
        limit: q.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  async get(i: CustomerIdentity, id: string) {
    this.require(i, permissions.workOrdersView);
    const row = await this.find(this.db, i, id);
    return {
      data: await this.detail(this.db, i, row),
      etag: etag(row.rowVersion),
    };
  }

  async create(
    i: CustomerIdentity,
    key: string | undefined,
    b: CreateWorkOrderDto,
  ) {
    this.require(i, permissions.workOrdersManage);
    const idem = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const op = "post_work_orders";
      const requestHash = hash(b);
      const replay = await this.replay(tx, i, op, idem, requestHash);
      if (replay) return this.result(tx, i, await this.find(tx, i, replay));
      const order = await tx.customerOrder.findFirst({
        where: {
          id: b.customerOrderId,
          countryCode: { in: [...i.countryCodes] },
          account: { OR: accountAccessWhere(i, "VIEW") },
        },
        include: { lines: true },
      });
      if (!order) missing("CUSTOMER_ORDER_NOT_FOUND");
      if (!PRODUCIBLE.includes(order.statusCode)) rule("ORDER_NOT_PRODUCIBLE");
      const boards = order.lines.reduce(
        (sum, line) => sum + Number(line.quantity),
        0,
      );
      const quantity = b.quantityPlanned ? Number(b.quantityPlanned) : boards;
      if (!(quantity > 0)) rule("WORK_ORDER_QUANTITY_INVALID");
      const rate = await tx.capacityRate.findFirst({
        where: {
          categoryCode: b.capacityCategoryCode,
          statusCode: "ACTIVE",
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!rate) rule("CAPACITY_CATEGORY_UNKNOWN");
      const end =
        b.plannedEndDate ??
        plannedEnd(
          b.plannedStartDate,
          productionDays(quantity, rate.boardsPerDay),
        );
      if (end < b.plannedStartDate) rule("WORK_ORDER_DATES_INVALID");
      const row = await tx.workOrder.create({
        data: {
          customerOrderId: order.id,
          accountId: order.accountId,
          countryCode: order.countryCode,
          productionLineCode: b.productionLineCode,
          capacityCategoryCode: b.capacityCategoryCode,
          boardsPerDaySnapshot: rate.boardsPerDay,
          quantityPlanned: new Prisma.Decimal(quantity),
          plannedStartDate: new Date(b.plannedStartDate),
          plannedEndDate: new Date(end),
          priorityCode: b.priorityCode ?? "NORMAL",
          notes: blank(b.notes),
          createdByUserId: i.userId,
          events: {
            create: {
              eventCode: "PLANNED",
              toStatusCode: "PLANNED",
              actorUserId: i.userId,
              details: {
                orderRef: order.orderRef,
                boardsPerDay: rate.boardsPerDay,
                plannedStartDate: b.plannedStartDate,
                plannedEndDate: end,
              },
            },
          },
        },
      });
      await this.remember(tx, i, op, idem, requestHash, row.id);
      await this.record(tx, i, "WORK_ORDER_PLANNED", row.id, {
        customerOrderId: order.id,
        quantity,
        plannedStartDate: b.plannedStartDate,
        plannedEndDate: end,
      });
      return this.result(tx, i, await this.find(tx, i, row.id));
    });
  }

  async reschedule(i: CustomerIdentity, id: string, b: RescheduleWorkOrderDto) {
    this.require(i, permissions.workOrdersManage);
    return this.txs.run(i, async (tx) => {
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      if (!canReschedule(row.statusCode)) rule("WORK_ORDER_NOT_RESCHEDULABLE");
      if ((blank(b.reason) ?? "").length < 3)
        rule("RESCHEDULE_REASON_REQUIRED");
      const start = b.plannedStartDate ?? isoDay(row.plannedStartDate);
      const end = b.plannedEndDate ?? isoDay(row.plannedEndDate);
      if (end < start) rule("WORK_ORDER_DATES_INVALID");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const note = (field: string, from: unknown, to: unknown) => {
        if (to !== undefined && from !== to) changes[field] = { from, to };
      };
      note("productionLineCode", row.productionLineCode, b.productionLineCode);
      note(
        "plannedStartDate",
        isoDay(row.plannedStartDate),
        b.plannedStartDate,
      );
      note("plannedEndDate", isoDay(row.plannedEndDate), b.plannedEndDate);
      note("priorityCode", row.priorityCode, b.priorityCode);
      note(
        "notes",
        row.notes,
        b.notes === undefined ? undefined : blank(b.notes),
      );
      if (Object.keys(changes).length === 0) rule("RESCHEDULE_CHANGES_NOTHING");
      const updated = await tx.workOrder.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data: {
          ...(b.productionLineCode
            ? { productionLineCode: b.productionLineCode }
            : {}),
          plannedStartDate: new Date(start),
          plannedEndDate: new Date(end),
          ...(b.priorityCode ? { priorityCode: b.priorityCode } : {}),
          ...(b.notes !== undefined ? { notes: blank(b.notes) } : {}),
          rowVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) precondition();
      await tx.workOrderEvent.create({
        data: {
          workOrderId: id,
          eventCode: "RESCHEDULED",
          fromStatusCode: row.statusCode,
          toStatusCode: row.statusCode,
          note: blank(b.reason),
          details: changes as Prisma.InputJsonValue,
          actorUserId: i.userId,
        },
      });
      await this.record(tx, i, "WORK_ORDER_RESCHEDULED", id, {
        changes: Object.keys(changes),
      });
      return this.result(tx, i, await this.find(tx, i, id));
    });
  }

  async transition(
    i: CustomerIdentity,
    key: string | undefined,
    id: string,
    b: WorkOrderTransitionDto,
  ) {
    this.require(i, permissions.workOrdersView);
    const idem = requireKey(key);
    return this.txs.run(i, async (tx) => {
      const op = "post_work_orders_transitions";
      const requestHash = hash({ id, b });
      const replay = await this.replay(tx, i, op, idem, requestHash);
      if (replay) return this.result(tx, i, await this.find(tx, i, replay));
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      const from = row.statusCode;
      const to = b.targetStatusCode;
      if (!canMoveWorkOrder(from, to)) rule("WORK_ORDER_TRANSITION_INVALID");
      // The quality check is its own authority; everything else is planning.
      this.require(
        i,
        from === "QC" ? permissions.workOrdersQc : permissions.workOrdersManage,
      );
      const missingFields = moveRequirements(from, to, b);
      if (missingFields.length > 0)
        throw new ApiProblem({
          status: 422,
          code: "WORK_ORDER_STEP_INCOMPLETE",
          params: { fields: missingFields.join(",") },
        });
      const now = new Date();
      const data: Prisma.WorkOrderUpdateManyMutationInput = {
        statusCode: to,
        rowVersion: { increment: 1 },
        updatedAt: now,
      };
      if (to === "IN_PROGRESS" && row.actualStartAt === null)
        data.actualStartAt = now;
      if (to === "ON_HOLD") data.holdReason = blank(b.reason);
      if (to === "CANCELLED") data.cancelReason = blank(b.reason);
      if (to === "QC") {
        data.quantityProduced = new Prisma.Decimal(b.quantityProduced ?? "0");
        if (b.quantityRejected)
          data.quantityRejected = new Prisma.Decimal(b.quantityRejected);
      }
      if (from === "QC") {
        data.qcResultCode = b.qcResultCode ?? null;
        data.qcNotes = blank(b.qcNotes);
        data.qcByUserId = i.userId;
        data.qcAt = now;
      }
      if (to === "COMPLETED") data.actualEndAt = now;
      const updated = await tx.workOrder.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data,
      });
      if (updated.count !== 1) precondition();
      await tx.workOrderEvent.create({
        data: {
          workOrderId: id,
          eventCode:
            from === "QC"
              ? to === "COMPLETED"
                ? "QC_PASSED"
                : "QC_FAILED"
              : "STATUS_CHANGED",
          fromStatusCode: from,
          toStatusCode: to,
          note: blank(b.qcNotes) ?? blank(b.reason),
          details: {
            ...(b.quantityProduced
              ? { quantityProduced: b.quantityProduced }
              : {}),
            ...(b.quantityRejected
              ? { quantityRejected: b.quantityRejected }
              : {}),
            ...(b.qcResultCode ? { qcResultCode: b.qcResultCode } : {}),
          },
          actorUserId: i.userId,
        },
      });
      await this.followOrder(tx, i, row.customerOrderId, row.workOrderRef);
      await this.remember(tx, i, op, idem, requestHash, id);
      await this.record(tx, i, "WORK_ORDER_STATUS_CHANGED", id, { from, to });
      return this.result(tx, i, await this.find(tx, i, id));
    });
  }

  /**
   * Gantt rows for a window: each run on its line, against the date its
   * customer asked for, with the shipment dates planned for the same order.
   */
  async schedule(i: CustomerIdentity, q: ProductionScheduleQuery) {
    this.require(i, permissions.workOrdersView);
    if (q.from > q.to) rule("SCHEDULE_RANGE_INVALID");
    const span =
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) /
      86_400_000;
    if (span > 130) rule("SCHEDULE_RANGE_INVALID");
    const rows = await this.db.workOrder.findMany({
      where: {
        ...this.scope(i),
        statusCode: { not: "CANCELLED" },
        plannedStartDate: { lte: new Date(q.to) },
        plannedEndDate: { gte: new Date(q.from) },
      },
      include: withContext,
      orderBy: [{ productionLineCode: "asc" }, { plannedStartDate: "asc" }],
      take: 1000,
    });
    const orderIds = [...new Set(rows.map((row) => row.customerOrderId))];
    const shipments =
      orderIds.length === 0
        ? []
        : await this.db.shipment.findMany({
            where: { customerOrderId: { in: orderIds } },
            select: {
              id: true,
              shipmentRef: true,
              customerOrderId: true,
              plannedDispatchDate: true,
              expectedDeliveryDate: true,
              milestoneCode: true,
            },
          });
    const rates = await this.db.capacityRate.findMany({
      where: { statusCode: "ACTIVE" },
      orderBy: [{ categoryCode: "asc" }, { effectiveFrom: "desc" }],
    });
    const today = isoDay(new Date());
    return {
      data: {
        from: q.from,
        to: q.to,
        today,
        lines: [...new Set(rows.map((row) => row.productionLineCode))],
        capacity: [
          ...new Map(rates.map((rate) => [rate.categoryCode, rate])).values(),
        ].map((rate) => ({
          categoryCode: rate.categoryCode,
          boardsPerDay: rate.boardsPerDay,
        })),
        workOrders: rows.map((row) => ({
          ...dto(row, today),
          overlapsOnLine: rows.some(
            (other) =>
              other.id !== row.id &&
              other.productionLineCode === row.productionLineCode &&
              other.statusCode !== "COMPLETED" &&
              row.statusCode !== "COMPLETED" &&
              other.plannedStartDate <= row.plannedEndDate &&
              other.plannedEndDate >= row.plannedStartDate,
          ),
          shipments: shipments
            .filter((one) => one.customerOrderId === row.customerOrderId)
            .map((one) => ({
              shipmentId: one.id,
              shipmentRef: one.shipmentRef,
              milestoneCode: one.milestoneCode,
              plannedDispatchDate: one.plannedDispatchDate
                ? isoDay(one.plannedDispatchDate)
                : null,
              expectedDeliveryDate: one.expectedDeliveryDate
                ? isoDay(one.expectedDeliveryDate)
                : null,
            })),
        })),
      },
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Move the order to where its work orders say it is. */
  private async followOrder(
    tx: TransactionClient,
    i: CustomerIdentity,
    customerOrderId: string,
    workOrderRef: string,
  ) {
    const order = await tx.customerOrder.findUnique({
      where: { id: customerOrderId },
    });
    if (!order) return;
    const work = await tx.workOrder.findMany({
      where: { customerOrderId },
      select: { statusCode: true },
    });
    const next = orderStatusFromWork(
      order.statusCode,
      work.map((one) => one.statusCode),
    );
    if (next === null) return;
    const moved = await tx.customerOrder.updateMany({
      where: { id: order.id, rowVersion: order.rowVersion },
      data: {
        statusCode: next,
        rowVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (moved.count !== 1) precondition();
    await tx.customerOrderEvent.create({
      data: {
        customerOrderId: order.id,
        eventCode: "STATUS_CHANGED",
        fromStatusCode: order.statusCode,
        toStatusCode: next,
        note:
          next === "READY"
            ? `Production complete — ${workOrderRef}`
            : `Production started — ${workOrderRef}`,
        details: { workOrderRef, automatic: true },
        actorUserId: i.userId,
      },
    });
  }

  private scope(i: CustomerIdentity): Prisma.WorkOrderWhereInput {
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
    const row = await db.workOrder.findFirst({
      where: { id, ...this.scope(i) },
      include: withContext,
    });
    if (!row) missing("WORK_ORDER_NOT_FOUND");
    return row;
  }

  private async result(
    tx: TransactionClient,
    i: CustomerIdentity,
    row: WorkOrderRow,
  ) {
    return { data: await this.detail(tx, i, row), etag: etag(row.rowVersion) };
  }

  private async detail(
    db: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    row: WorkOrderRow,
  ) {
    const events = await db.workOrderEvent.findMany({
      where: { workOrderId: row.id },
      orderBy: { createdAt: "asc" },
    });
    const users = await db.appUser.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              ...events.map((event) => event.actorUserId),
              row.qcByUserId ?? "",
            ]),
          ].filter(Boolean),
        },
      },
      select: { id: true, displayName: true },
    });
    const nameOf = (userId: string | null) =>
      users.find((user) => user.id === userId)?.displayName ?? null;
    const held = (code: string) =>
      i.permissions.has(code) && !i.deniedPermissions.has(code);
    // The quality check is its own authority; every other move is planning.
    const mayMove =
      row.statusCode === "QC"
        ? held(permissions.workOrdersQc)
        : held(permissions.workOrdersManage);
    const moves = mayMove ? allowedWorkOrderMoves(row.statusCode) : [];
    // A line makes one run at a time: other live runs on the same line whose
    // dates cross this one's are shown, so the planner sees the clash.
    const overlaps =
      row.statusCode === "COMPLETED" || row.statusCode === "CANCELLED"
        ? []
        : await db.workOrder.findMany({
            where: {
              id: { not: row.id },
              productionLineCode: row.productionLineCode,
              statusCode: { notIn: ["COMPLETED", "CANCELLED"] },
              plannedStartDate: { lte: row.plannedEndDate },
              plannedEndDate: { gte: row.plannedStartDate },
            },
            select: {
              id: true,
              workOrderRef: true,
              plannedStartDate: true,
              plannedEndDate: true,
            },
            take: 20,
          });
    return {
      ...dto(row, isoDay(new Date())),
      overlaps: overlaps.map((one) => ({
        workOrderId: one.id,
        workOrderRef: one.workOrderRef,
        plannedStartDate: isoDay(one.plannedStartDate),
        plannedEndDate: isoDay(one.plannedEndDate),
      })),
      qcByName: nameOf(row.qcByUserId),
      allowedTransitions: moves,
      canReschedule:
        held(permissions.workOrdersManage) && canReschedule(row.statusCode),
      events: events.map((event) => ({
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

  private require(i: CustomerIdentity, p: string) {
    if (
      !hasWorkspace(i, "SALES") &&
      !hasWorkspace(i, "LOGISTICS") &&
      !hasWorkspace(i, "RND")
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
      resourceType: "WorkOrder",
      resourceId: id,
      workspace: "SALES",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "work-orders-api",
    });
  }
}

function dto(row: WorkOrderRow, today: string) {
  const requested = row.order.requestedDeliveryDate
    ? isoDay(row.order.requestedDeliveryDate)
    : null;
  const end = isoDay(row.plannedEndDate);
  return {
    workOrderId: row.id,
    workOrderRef: row.workOrderRef,
    customerOrderId: row.customerOrderId,
    orderRef: row.order.orderRef,
    orderStatusCode: row.order.statusCode,
    quotationId: row.order.quotationId,
    accountId: row.accountId,
    accountName: row.account.canonicalName,
    countryCode: row.countryCode.trim(),
    statusCode: row.statusCode,
    productionLineCode: row.productionLineCode,
    capacityCategoryCode: row.capacityCategoryCode,
    boardsPerDay: row.boardsPerDaySnapshot,
    quantityPlanned: row.quantityPlanned.toString(),
    quantityProduced: row.quantityProduced.toString(),
    quantityRejected: row.quantityRejected.toString(),
    plannedStartDate: isoDay(row.plannedStartDate),
    plannedEndDate: end,
    actualStartAt: row.actualStartAt?.toISOString() ?? null,
    actualEndAt: row.actualEndAt?.toISOString() ?? null,
    requestedDeliveryDate: requested,
    priorityCode: row.priorityCode,
    notes: row.notes,
    qcResultCode: row.qcResultCode,
    qcNotes: row.qcNotes,
    qcAt: row.qcAt?.toISOString() ?? null,
    holdReason: row.holdReason,
    cancelReason: row.cancelReason,
    risk: scheduleRisk({
      status: row.statusCode,
      plannedEnd: end,
      requestedDelivery: requested,
      today,
    }),
    rowVersion: row.rowVersion.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
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
function etag(v: bigint) {
  return `"${v.toString()}"`;
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
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
