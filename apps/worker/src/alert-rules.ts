/**
 * What deserves a nudge, and who gets it. Pure, so it is tested without a
 * database; the scanner feeds it rows and writes what it returns.
 *
 * Every alert carries a key built from what it is about and the date that
 * made it due, so the same thing is announced once -- and again only if it
 * changes (a new due date, a new stage) -- however often the scanner runs.
 */

export type AlertTypeCode =
  | "PAYMENT_OVERDUE"
  | "OVERDUE_TASK"
  | "PRODUCTION_AT_RISK"
  | "DELIVERY_LATE"
  | "FEEDBACK_REQUEST"
  | "QUOTATION_EXPIRING"
  | "BACKUP_PROBLEM";

export interface Alert {
  key: string;
  recipients: string[];
  typeCode: AlertTypeCode;
  title: string;
  body: string;
  resourceTypeCode: string;
  resourceId: string;
}

const day = (value: Date) => value.toISOString().slice(0, 10);
const money = (value: number, currency: string) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency.trim()}`;
const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(
    ids.filter((id): id is string => typeof id === "string" && id !== ""),
  ),
];

export function overduePayment(row: {
  id: string;
  label: string;
  dueDate: Date;
  outstanding: number;
  currencyCode: string;
  orderId: string;
  orderRef: string;
  orderOwnerUserId: string;
  accountName: string;
}): Alert | null {
  // Not one pound of credit: any amount late is worth telling about.
  if (!(row.outstanding > 0)) return null;
  return {
    key: `PAYMENT_OVERDUE:${row.id}:${day(row.dueDate)}`,
    recipients: unique([row.orderOwnerUserId]),
    typeCode: "PAYMENT_OVERDUE",
    title: `Payment overdue — ${row.accountName}`,
    body: `${row.orderRef} · ${row.label}: ${money(row.outstanding, row.currencyCode)} was due ${day(row.dueDate)}.`,
    resourceTypeCode: "CUSTOMER_ORDER",
    resourceId: row.orderId,
  };
}

/**
 * The same late payment, told to the salesperson's manager: whose customer,
 * which order, how much. A separate alert, so a manager added later still
 * hears about payments already late.
 */
export function overduePaymentForManager(row: {
  id: string;
  label: string;
  dueDate: Date;
  outstanding: number;
  currencyCode: string;
  orderId: string;
  orderRef: string;
  ownerName: string;
  /** The salesperson's manager -- or the sales managers when none is set. */
  managerUserIds: string[];
  accountName: string;
}): Alert | null {
  if (!(row.outstanding > 0) || row.managerUserIds.length === 0) return null;
  return {
    key: `PAYMENT_OVERDUE_MANAGER:${row.id}:${day(row.dueDate)}`,
    recipients: unique(row.managerUserIds),
    typeCode: "PAYMENT_OVERDUE",
    title: `${row.ownerName}'s customer is late — ${row.accountName}`,
    body: `${row.orderRef} · ${row.label}: ${money(row.outstanding, row.currencyCode)} was due ${day(row.dueDate)}.`,
    resourceTypeCode: "CUSTOMER_ORDER",
    resourceId: row.orderId,
  };
}

export function lateComplaintStage(row: {
  id: string;
  complaintRef: string;
  statusCode: string;
  stageEnteredAt: Date;
  stageDueAt: Date;
  assigneeUserId: string | null;
  ownerUserId: string;
}): Alert {
  return {
    key: `COMPLAINT_LATE:${row.id}:${row.stageEnteredAt.toISOString()}`,
    recipients: unique([row.assigneeUserId ?? row.ownerUserId]),
    typeCode: "OVERDUE_TASK",
    title: `Complaint ${row.complaintRef} is past its stage deadline`,
    body: `${row.statusCode.replaceAll("_", " ").toLowerCase()} was due ${day(row.stageDueAt)}.`,
    resourceTypeCode: "COMPLAINT",
    resourceId: row.id,
  };
}

/**
 * A run is at risk when its planned end has passed unfinished, or when it
 * ends less than two days before the date the customer asked for.
 */
export function productionRisk(row: {
  id: string;
  workOrderRef: string;
  statusCode: string;
  plannedEndDate: Date;
  requestedDeliveryDate: Date | null;
  orderRef: string;
  orderOwnerUserId: string;
  createdByUserId: string;
  today: Date;
}): Alert | null {
  if (row.statusCode === "COMPLETED" || row.statusCode === "CANCELLED")
    return null;
  const end = day(row.plannedEndDate);
  const today = day(row.today);
  let reason: string | null = null;
  if (end < today) reason = `was planned to finish ${end}`;
  else if (row.requestedDeliveryDate !== null) {
    const latestEnd = new Date(
      row.requestedDeliveryDate.getTime() - 2 * 86_400_000,
    );
    if (row.plannedEndDate > latestEnd)
      reason = `ends ${end}, too close to the customer's date ${day(row.requestedDeliveryDate)}`;
  }
  if (reason === null) return null;
  return {
    key: `PRODUCTION_AT_RISK:${row.id}:${end}`,
    recipients: unique([row.orderOwnerUserId, row.createdByUserId]),
    typeCode: "PRODUCTION_AT_RISK",
    title: `${row.workOrderRef} for ${row.orderRef} is at risk`,
    body: `The run ${reason}.`,
    resourceTypeCode: "WORK_ORDER",
    resourceId: row.id,
  };
}

export function lateDelivery(row: {
  id: string;
  shipmentRef: string;
  expectedDeliveryDate: Date;
  orderRef: string;
  orderOwnerUserId: string;
  accountName: string;
}): Alert {
  return {
    key: `DELIVERY_LATE:${row.id}:${day(row.expectedDeliveryDate)}`,
    recipients: unique([row.orderOwnerUserId]),
    typeCode: "DELIVERY_LATE",
    title: `Delivery late — ${row.accountName}`,
    body: `${row.shipmentRef} (${row.orderRef}) was expected ${day(row.expectedDeliveryDate)} and is not delivered.`,
    resourceTypeCode: "SHIPMENT",
    resourceId: row.id,
  };
}

export function askForFeedback(row: {
  orderId: string;
  orderRef: string;
  orderOwnerUserId: string;
  accountName: string;
}): Alert {
  return {
    key: `FEEDBACK_REQUEST:${row.orderId}`,
    recipients: unique([row.orderOwnerUserId]),
    typeCode: "FEEDBACK_REQUEST",
    title: `Ask ${row.accountName} how it went`,
    body: `${row.orderRef} has been delivered. "Ask for feedback" on the order copies a link to send them.`,
    resourceTypeCode: "CUSTOMER_ORDER",
    resourceId: row.orderId,
  };
}

/**
 * A sent offer the customer has not taken, running out: three days' warning,
 * while there is still time to call. Keyed on the expiry date, so extending
 * the validity on a new version warns again.
 */
export function quotationExpiring(row: {
  id: string;
  quotationRef: string;
  expiresOn: Date;
  ownerUserId: string;
  accountName: string;
  today: Date;
}): Alert | null {
  const days = Math.round(
    (row.expiresOn.getTime() - row.today.getTime()) / 86_400_000,
  );
  if (days < 0 || days > 3) return null;
  const when =
    days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${String(days)} days`;
  return {
    key: `QUOTATION_EXPIRING:${row.id}:${day(row.expiresOn)}`,
    recipients: unique([row.ownerUserId]),
    typeCode: "QUOTATION_EXPIRING",
    title: `${row.quotationRef} for ${row.accountName} expires ${when}`,
    body: `The offer is valid until ${day(row.expiresOn)} and the customer has not accepted it yet.`,
    resourceTypeCode: "QUOTATION",
    resourceId: row.id,
  };
}

/** The offer has lapsed: say so, and what to do about it. */
export function quotationExpired(row: {
  id: string;
  quotationRef: string;
  expiresOn: Date;
  ownerUserId: string;
  accountName: string;
}): Alert {
  return {
    key: `QUOTATION_EXPIRED:${row.id}`,
    recipients: unique([row.ownerUserId]),
    typeCode: "QUOTATION_EXPIRING",
    title: `${row.quotationRef} for ${row.accountName} has expired`,
    body: `It was valid until ${day(row.expiresOn)}. Copy it to send the customer a fresh offer.`,
    resourceTypeCode: "QUOTATION",
    resourceId: row.id,
  };
}

/**
 * The last backup failed, or there has not been one for a day and a half.
 * Told to the administrators once per failed backup, and once per day while
 * backups are missing.
 */
export function backupProblem(input: {
  status: unknown;
  now: Date;
  administrators: string[];
}): Alert | null {
  const status =
    typeof input.status === "object" && input.status !== null
      ? (input.status as Record<string, unknown>)
      : null;
  const name = typeof status?.name === "string" ? status.name : "";
  const finished = Date.parse(
    typeof status?.finishedAt === "string" ? status.finishedAt : "",
  );
  const base = {
    recipients: unique(input.administrators),
    typeCode: "BACKUP_PROBLEM" as const,
    resourceTypeCode: "SYSTEM",
    resourceId: "00000000-0000-4000-8000-00000000b4c0",
  };
  if (status !== null && status.ok === false)
    return {
      ...base,
      key: `BACKUP_FAILED:${name}`,
      title: "Last night's backup failed",
      body: `${typeof status.error === "string" && status.error ? status.error : "No reason was recorded."} See Administration → System.`,
    };
  if (
    !Number.isFinite(finished) ||
    input.now.getTime() - finished > 36 * 3_600_000
  )
    return {
      ...base,
      key: `BACKUP_MISSING:${day(input.now)}`,
      title: "No backup in the last 36 hours",
      body: Number.isFinite(finished)
        ? `The last backup finished ${new Date(finished).toISOString().slice(0, 16).replace("T", " ")} UTC. Check that the backup service is running.`
        : "No backup has been recorded. Check that the backup service is running.",
    };
  return null;
}

/** Whether this person wants this kind of notification (absent means yes). */
export function wants(preferences: unknown, typeCode: string): boolean {
  if (typeof preferences !== "object" || preferences === null) return true;
  const muted = (preferences as Record<string, unknown>).mutedNotifications;
  return !Array.isArray(muted) || !muted.includes(typeCode);
}
