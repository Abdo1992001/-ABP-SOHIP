import { Prisma } from "@abp/database";

/**
 * Advance + equal-installments payment schedule. Server-authoritative:
 * computed and persisted once at save time (Quotation.paymentScheduleJson),
 * so the live web preview, the document prose, and this calculation never
 * drift apart. Amounts always sum exactly to grandTotal — the last
 * installment absorbs any rounding remainder.
 */

export interface PaymentScheduleInput {
  advancePct: Prisma.Decimal;
  installments: number;
  frequencyDays: number;
  referenceDate: Date | null;
  paymentMethod: string;
  grandTotal: Prisma.Decimal;
}

export interface PaymentScheduleRow {
  stage: "ADVANCE" | "INSTALLMENT";
  index: number;
  label: string;
  pct: string;
  amount: string;
  dueTiming: "BEFORE_DELIVERY" | "DAYS_AFTER_REFERENCE";
  daysAfter: number | null;
  dueDate: string | null;
  method: string;
}

export interface PaymentScheduleResult {
  advancePct: string;
  installments: number;
  frequencyDays: number;
  referenceDate: string | null;
  paymentMethod: string;
  grandTotal: string;
  rows: PaymentScheduleRow[];
  prose: string;
}

function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function formatMoney(value: Prisma.Decimal): string {
  return Number(value.toFixed(2)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computePaymentSchedule(
  input: PaymentScheduleInput,
): PaymentScheduleResult {
  const installments = Math.max(1, Math.floor(input.installments));
  const advancePct = input.advancePct;
  const advanceAmount = round2(input.grandTotal.mul(advancePct).div(100));
  const remaining = input.grandTotal.minus(advanceAmount);
  const eachPct = new Prisma.Decimal(100).minus(advancePct).div(installments);

  const rows: PaymentScheduleRow[] = [
    {
      stage: "ADVANCE",
      index: 0,
      label: "Advance Payment",
      pct: advancePct.toString(),
      amount: advanceAmount.toFixed(2),
      dueTiming: "BEFORE_DELIVERY",
      daysAfter: null,
      dueDate: null,
      method: input.paymentMethod,
    },
  ];

  let runningInstallmentTotal = new Prisma.Decimal(0);
  for (let i = 1; i <= installments; i += 1) {
    const isLast = i === installments;
    const daysAfter = i * input.frequencyDays;
    const amount = isLast
      ? remaining.minus(runningInstallmentTotal)
      : round2(input.grandTotal.mul(eachPct).div(100));
    runningInstallmentTotal = runningInstallmentTotal.plus(amount);
    rows.push({
      stage: "INSTALLMENT",
      index: i,
      label:
        input.paymentMethod === "CHEQUE"
          ? `Cheque ${String(i)}`
          : `Installment ${String(i)}`,
      pct: eachPct.toDecimalPlaces(4).toString(),
      amount: amount.toFixed(2),
      dueTiming: "DAYS_AFTER_REFERENCE",
      daysAfter,
      dueDate: input.referenceDate
        ? isoDate(addDays(input.referenceDate, daysAfter))
        : null,
      method: input.paymentMethod,
    });
  }

  const remainderPct = new Prisma.Decimal(100).minus(advancePct);
  const installmentClauses = rows
    .filter((row) => row.stage === "INSTALLMENT")
    .map((row, position, all) => {
      const isFirst = position === 0;
      const isLast = position === all.length - 1;
      const suffix = isFirst || isLast ? " from the delivery date" : "";
      return `${formatMoney(new Prisma.Decimal(row.amount))} after ${String(row.daysAfter)} days${suffix}`;
    });
  // An index into an array is `string | undefined` under noUncheckedIndexedAccess,
  // and an empty schedule would otherwise print "undefined" into a customer
  // document.
  const lastClause = installmentClauses.at(-1) ?? "";
  const installmentText =
    installmentClauses.length > 1
      ? `${installmentClauses.slice(0, -1).join(", ")}, and ${lastClause}`
      : lastClause;
  const methodText =
    input.paymentMethod === "CHEQUE" ? "post-dated cheques" : "installments";
  const prose =
    `Payment Terms: ${advancePct.toString()}% in advance (${formatMoney(advanceAmount)}). ` +
    `The remaining ${remainderPct.toString()}% shall be paid through ${String(installments)} equal ${methodText} as follows: ${installmentText}.`;

  return {
    advancePct: advancePct.toString(),
    installments,
    frequencyDays: input.frequencyDays,
    referenceDate: input.referenceDate ? isoDate(input.referenceDate) : null,
    paymentMethod: input.paymentMethod,
    grandTotal: input.grandTotal.toFixed(2),
    rows,
    prose,
  };
}
