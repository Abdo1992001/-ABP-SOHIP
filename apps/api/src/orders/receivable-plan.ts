/**
 * How a customer order's payment schedule becomes installments that can be
 * owed, collected and aged. Pure, so it can be tested without Nest or a
 * database.
 *
 * Money is handled in whole cents: the amounts are at most a few billion, so
 * cents stay exact in a double, and splitting a total in cents is the only way
 * to make the parts add back up to it.
 */

export type DueBasis = "BEFORE_DELIVERY" | "AFTER_HANDOVER" | "FIXED_DATE";
export type StageCode = "ADVANCE" | "INSTALLMENT" | "FULL";

export interface PlannedInstallment {
  installmentNo: number;
  label: string;
  stageCode: StageCode;
  dueBasisCode: DueBasis;
  daysAfter: number | null;
  /** ISO date (yyyy-mm-dd), or null while the clock has not started. */
  dueDate: string | null;
  amount: string;
  methodCode: string | null;
}

const cents = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};
const money = (value: number): string => (value / 100).toFixed(2);

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/**
 * Split `total` across `weights` in proportion, in cents, with the rounding
 * left on the last part so the parts always add up to the total exactly.
 */
export function splitByWeights(total: string, weights: number[]): string[] {
  const whole = cents(total);
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    return weights.map((_, index) =>
      money(index === weights.length - 1 ? whole : 0),
    );
  }
  let allotted = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return money(whole - allotted);
    const part = Math.round((whole * weight) / sum);
    allotted += part;
    return money(part);
  });
}

interface ScheduleRow {
  label?: unknown;
  stage?: unknown;
  amount?: unknown;
  pct?: unknown;
  method?: unknown;
  dueDate?: unknown;
  daysAfter?: unknown;
  dueTiming?: unknown;
}

function scheduleRows(schedule: unknown): ScheduleRow[] {
  if (schedule === null || typeof schedule !== "object") return [];
  const rows = (schedule as { rows?: unknown }).rows;
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is ScheduleRow => row !== null && typeof row === "object",
      )
    : [];
}

function referenceDate(schedule: unknown): string | null {
  if (schedule === null || typeof schedule !== "object") return null;
  const value = (schedule as { referenceDate?: unknown }).referenceDate;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;
}

/**
 * The installments an order owes, from the schedule it carries.
 *
 * The schedule's amounts were computed against the quotation's total; the
 * order's total may since have been amended, so they are used as weights and
 * the order total is split across them. An order with no schedule owes one
 * full payment, due on confirmation.
 */
export function planInstallments(input: {
  schedule: unknown;
  total: string;
  confirmedOn: string;
  handedOverOn?: string | null;
}): PlannedInstallment[] {
  const rows = scheduleRows(input.schedule);
  if (rows.length === 0) {
    return [
      {
        installmentNo: 1,
        label: "Full payment",
        stageCode: "FULL",
        dueBasisCode: "BEFORE_DELIVERY",
        daysAfter: null,
        dueDate: input.confirmedOn,
        amount: money(cents(input.total)),
        methodCode: null,
      },
    ];
  }
  const weights = rows.map((row) => {
    const amount = cents(row.amount);
    return amount > 0 ? amount : Math.max(0, Number(row.pct) || 0);
  });
  const amounts = splitByWeights(input.total, weights);
  const reference = referenceDate(input.schedule);
  return rows.map((row, index) => {
    const days =
      typeof row.daysAfter === "number" && Number.isFinite(row.daysAfter)
        ? Math.max(0, Math.round(row.daysAfter))
        : null;
    const fixed =
      typeof row.dueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.dueDate)
        ? row.dueDate.slice(0, 10)
        : null;
    let dueBasisCode: DueBasis = "BEFORE_DELIVERY";
    let dueDate: string | null = input.confirmedOn;
    if (fixed !== null) {
      dueBasisCode = "FIXED_DATE";
      dueDate = fixed;
    } else if (row.dueTiming === "DAYS_AFTER_REFERENCE") {
      if (reference !== null) {
        dueBasisCode = "FIXED_DATE";
        dueDate = addDays(reference, days ?? 0);
      } else {
        dueBasisCode = "AFTER_HANDOVER";
        dueDate =
          input.handedOverOn == null
            ? null
            : addDays(input.handedOverOn, days ?? 0);
      }
    }
    const stage = row.stage === "ADVANCE" ? "ADVANCE" : "INSTALLMENT";
    return {
      installmentNo: index + 1,
      label:
        typeof row.label === "string" && row.label.trim() !== ""
          ? row.label.trim()
          : `Installment ${String(index + 1)}`,
      stageCode: stage,
      dueBasisCode,
      daysAfter: days,
      dueDate,
      amount: amounts[index] ?? "0.00",
      methodCode: typeof row.method === "string" ? row.method : null,
    };
  });
}

export type InstallmentStatus =
  "OPEN" | "PARTIAL" | "PAID" | "WRITTEN_OFF" | "CANCELLED";

/** Where an installment stands once its collections and write-offs are counted. */
export function settleStatus(
  amount: string,
  collected: string,
  writtenOff: string,
): InstallmentStatus {
  const owed = cents(amount);
  const paid = cents(collected);
  const off = cents(writtenOff);
  if (paid + off >= owed)
    return off > 0 && paid < owed ? "WRITTEN_OFF" : "PAID";
  return paid > 0 ? "PARTIAL" : "OPEN";
}

export function outstanding(
  amount: string,
  collected: string,
  writtenOff: string,
): string {
  return money(
    Math.max(0, cents(amount) - cents(collected) - cents(writtenOff)),
  );
}

export type AgingBucket =
  | "SETTLED"
  | "NOT_SCHEDULED"
  | "NOT_DUE"
  | "OVERDUE_1_30"
  | "OVERDUE_31_60"
  | "OVERDUE_61_90"
  | "OVERDUE_90_PLUS";

export const AGING_BUCKETS: readonly AgingBucket[] = [
  "NOT_SCHEDULED",
  "NOT_DUE",
  "OVERDUE_1_30",
  "OVERDUE_31_60",
  "OVERDUE_61_90",
  "OVERDUE_90_PLUS",
];

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Which aging column an installment falls in on `today`. */
export function agingBucket(input: {
  dueDate: string | null;
  outstanding: string;
  today: string;
}): AgingBucket {
  if (cents(input.outstanding) <= 0) return "SETTLED";
  if (input.dueDate === null) return "NOT_SCHEDULED";
  const late = daysBetween(input.dueDate, input.today);
  if (late <= 0) return "NOT_DUE";
  if (late <= 30) return "OVERDUE_1_30";
  if (late <= 60) return "OVERDUE_31_60";
  if (late <= 90) return "OVERDUE_61_90";
  return "OVERDUE_90_PLUS";
}

/** Add two money strings exactly. */
export function addMoney(a: string, b: string): string {
  return money(cents(a) + cents(b));
}

export function compareMoney(a: string, b: string): number {
  return cents(a) - cents(b);
}
