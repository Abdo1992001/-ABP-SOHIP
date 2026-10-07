/**
 * Work orders: the factory's side of a customer order. Pure, so the route,
 * the scheduling arithmetic and the lateness rule are tested without Nest.
 *
 *   PLANNED -> RELEASED -> IN_PROGRESS -> QC -> COMPLETED
 *                 \            |  ^        |
 *                  \-> ON_HOLD <-  \-- rework (QC failed)
 *
 * PLANNED, RELEASED and ON_HOLD can be cancelled, with a reason.
 */

export const WORK_ORDER_STATUSES = [
  "PLANNED",
  "RELEASED",
  "IN_PROGRESS",
  "ON_HOLD",
  "QC",
  "COMPLETED",
  "CANCELLED",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const PRODUCTION_LINES = [
  "LINE_1",
  "LINE_2",
  "LINE_3",
  "CURVED_LINE",
] as const;
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const QC_RESULTS = ["PASS", "CONDITIONAL", "FAIL"] as const;

const NEXT: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  PLANNED: ["RELEASED", "CANCELLED"],
  RELEASED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["QC", "ON_HOLD"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
  QC: ["COMPLETED", "IN_PROGRESS"],
  COMPLETED: [],
  CANCELLED: [],
};

export function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

export function allowedWorkOrderMoves(
  from: string,
): readonly WorkOrderStatus[] {
  return isWorkOrderStatus(from) ? NEXT[from] : [];
}

export function canMoveWorkOrder(from: string, to: string): boolean {
  return allowedWorkOrderMoves(from).includes(to as WorkOrderStatus);
}

/** A schedule can still change until the work is being checked or is done. */
export function canReschedule(status: string): boolean {
  return ["PLANNED", "RELEASED", "ON_HOLD", "IN_PROGRESS"].includes(status);
}

/**
 * What a move needs on record, given the body that asks for it. Returns the
 * names of what is missing.
 */
export function moveRequirements(
  from: string,
  to: string,
  body: {
    reason?: string | null;
    quantityProduced?: string | null;
    qcResultCode?: string | null;
    qcNotes?: string | null;
  },
): string[] {
  const missing: string[] = [];
  const filled = (value: string | null | undefined, min = 1) =>
    typeof value === "string" && value.trim().length >= min;
  if ((to === "CANCELLED" || to === "ON_HOLD") && !filled(body.reason, 3))
    missing.push("reason");
  if (to === "QC" && !filled(body.quantityProduced))
    missing.push("quantityProduced");
  if (from === "QC") {
    if (!filled(body.qcResultCode)) missing.push("qcResultCode");
    // A failed or conditional check has to say what was found.
    if (body.qcResultCode !== "PASS" && !filled(body.qcNotes, 3))
      missing.push("qcNotes");
    if (to === "COMPLETED" && body.qcResultCode === "FAIL")
      missing.push("qcResultCode");
    if (to === "IN_PROGRESS" && body.qcResultCode === "PASS")
      missing.push("qcResultCode");
  }
  return [...new Set(missing)];
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * How many days a run of boards takes at a rate, rounded up to whole days,
 * and never less than one. A missing or zero rate is one day per run -- the
 * planner will see it and set the end date by hand.
 */
export function productionDays(
  boards: number,
  boardsPerDay: number | null,
): number {
  if (!(boards > 0)) return 1;
  if (boardsPerDay === null || !(boardsPerDay > 0)) return 1;
  return Math.max(1, Math.ceil(boards / boardsPerDay));
}

/** The planned last day of production: start plus the days, inclusive. */
export function plannedEnd(start: string, days: number): string {
  return addDays(start, Math.max(1, days) - 1);
}

export type ScheduleRisk = "DONE" | "ON_TIME" | "LATE_FOR_CUSTOMER" | "OVERDUE";

/**
 * How a work order stands against time: overdue when its planned end has
 * passed and it is not finished; late for the customer when it is planned to
 * finish less than `bufferDays` before the date the customer asked for (the
 * goods still have to be loaded and driven there).
 */
export function scheduleRisk(input: {
  status: string;
  plannedEnd: string;
  requestedDelivery: string | null;
  today: string;
  bufferDays?: number;
}): ScheduleRisk {
  if (input.status === "COMPLETED" || input.status === "CANCELLED")
    return "DONE";
  if (input.plannedEnd < input.today) return "OVERDUE";
  if (
    input.requestedDelivery !== null &&
    addDays(input.plannedEnd, input.bufferDays ?? 2) > input.requestedDelivery
  )
    return "LATE_FOR_CUSTOMER";
  return "ON_TIME";
}

/**
 * The order status the work orders imply, or null when they imply no change:
 * the first one started puts a confirmed order into production; the last one
 * completed makes the order ready.
 */
export function orderStatusFromWork(
  orderStatus: string,
  workStatuses: readonly string[],
): "IN_PRODUCTION" | "READY" | null {
  const live = workStatuses.filter((status) => status !== "CANCELLED");
  if (live.length === 0) return null;
  if (
    live.every((status) => status === "COMPLETED") &&
    (orderStatus === "CONFIRMED" || orderStatus === "IN_PRODUCTION")
  )
    return "READY";
  if (
    orderStatus === "CONFIRMED" &&
    live.some((status) =>
      ["IN_PROGRESS", "ON_HOLD", "QC", "COMPLETED"].includes(status),
    )
  )
    return "IN_PRODUCTION";
  return null;
}
