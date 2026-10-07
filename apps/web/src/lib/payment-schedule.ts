/**
 * Client-side mirror of apps/api/src/quotation/payment-schedule.ts, used
 * only for the live "Payment Schedule" preview while editing a quotation —
 * the server always recomputes and persists the authoritative schedule on
 * save. Keep both in sync when the formulas change.
 */

export type PaymentScheduleStage = "ADVANCE" | "INSTALLMENT";

export interface PaymentScheduleRow {
  stage: PaymentScheduleStage;
  index: number;
  label: string;
  pct: number;
  amount: number;
  dueTiming: "BEFORE_DELIVERY" | "DAYS_AFTER_REFERENCE";
  daysAfter: number | null;
  dueDate: string | null;
  method: string;
}

export interface PaymentScheduleInput {
  grandTotal: number;
  advancePct: number;
  installments: number;
  frequencyDays: number;
  referenceDate: string | null;
  paymentMethod: string;
}

export interface PaymentScheduleResult {
  rows: PaymentScheduleRow[];
  prose: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computePaymentSchedulePreview(
  input: PaymentScheduleInput,
): PaymentScheduleResult {
  const installments = Math.max(1, Math.floor(input.installments || 1));
  const advancePct = Number.isFinite(input.advancePct) ? input.advancePct : 0;
  const grandTotal = Number.isFinite(input.grandTotal) ? input.grandTotal : 0;
  const advanceAmount = round2(grandTotal * (advancePct / 100));
  const remaining = grandTotal - advanceAmount;
  const eachPct = (100 - advancePct) / installments;

  const rows: PaymentScheduleRow[] = [
    {
      stage: "ADVANCE",
      index: 0,
      label: "Advance Payment",
      pct: advancePct,
      amount: advanceAmount,
      dueTiming: "BEFORE_DELIVERY",
      daysAfter: null,
      dueDate: null,
      method: input.paymentMethod,
    },
  ];

  let runningTotal = 0;
  for (let i = 1; i <= installments; i += 1) {
    const isLast = i === installments;
    const daysAfter = i * (input.frequencyDays || 0);
    const amount = isLast
      ? round2(remaining - runningTotal)
      : round2(grandTotal * (eachPct / 100));
    runningTotal += amount;
    rows.push({
      stage: "INSTALLMENT",
      index: i,
      label:
        input.paymentMethod === "CHEQUE"
          ? `Cheque ${String(i)}`
          : `Installment ${String(i)}`,
      pct: eachPct,
      amount,
      dueTiming: "DAYS_AFTER_REFERENCE",
      daysAfter,
      dueDate: input.referenceDate
        ? addDays(input.referenceDate, daysAfter)
        : null,
      method: input.paymentMethod,
    });
  }

  const remainderPct = 100 - advancePct;
  const installmentRows = rows.filter((row) => row.stage === "INSTALLMENT");
  const clauses = installmentRows.map((row, position) => {
    const isFirst = position === 0;
    const isLast = position === installmentRows.length - 1;
    const suffix = isFirst || isLast ? " from the delivery date" : "";
    return `${formatMoney(row.amount)} after ${String(row.daysAfter)} days${suffix}`;
  });
  // An index into an array is `string | undefined` under
  // noUncheckedIndexedAccess, and an empty schedule would otherwise print
  // "undefined" into a customer document.
  const lastClause = clauses.at(-1) ?? "";
  const installmentText =
    clauses.length > 1
      ? `${clauses.slice(0, -1).join(", ")}, and ${lastClause}`
      : lastClause;
  const methodText =
    input.paymentMethod === "CHEQUE" ? "post-dated cheques" : "installments";
  const prose =
    `Payment Terms: ${String(advancePct)}% in advance (${formatMoney(advanceAmount)}). ` +
    `The remaining ${String(remainderPct)}% shall be paid through ${String(installments)} equal ${methodText} as follows: ${installmentText}.`;

  return { rows, prose };
}
