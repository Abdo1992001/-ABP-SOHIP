/**
 * How a customer order moves, and what an amendment does to its money.
 *
 * Kept free of Nest and Prisma so the rules can be tested on their own: these
 * are the decisions an auditor asks about -- who could move an order where,
 * and how a total was arrived at after the customer changed a quantity.
 */

export const ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "HANDED_OVER",
  "CLOSED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Forward, one step at a time, with two shortcuts a real order takes: a stock
 * item goes from confirmed straight to ready, and an order can be cancelled
 * until it has left the yard. Nothing comes back from handed-over, closed or
 * cancelled -- a correction after hand-over is a return, not an edit.
 */
const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "READY", "CANCELLED"],
  IN_PRODUCTION: ["READY", "CANCELLED"],
  READY: ["HANDED_OVER", "CANCELLED"],
  HANDED_OVER: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function allowedNext(from: OrderStatus): readonly OrderStatus[] {
  return NEXT[from];
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from].includes(to);
}

/** Header and quantities may change until production starts. */
export function canAmend(status: OrderStatus): boolean {
  return status === "DRAFT" || status === "CONFIRMED";
}

/**
 * Rounded half away from zero, to the piastre.
 *
 * 1.005 x 100 is 100.49999999999999 in binary, which rounds the wrong way;
 * taking it to 15 significant digits first removes the binary noise and
 * leaves the half the person typed.
 */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const cents = Number((Math.abs(value) * 100).toPrecision(15));
  return (sign * Math.round(cents)) / 100;
}

export interface OrderMoney {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * The order's totals from its lines, the way the quotation computed them:
 * the lines, then the quotation-level adjustments (freight, discounts), then
 * VAT on the result at the rate the quotation charged.
 */
export function orderTotals(
  lineTotals: readonly number[],
  adjustment: number,
  vatRate: number,
): OrderMoney {
  const subtotal = round2(lineTotals.reduce((sum, value) => sum + value, 0));
  const taxable = round2(subtotal + adjustment);
  const tax = round2(Math.max(0, taxable) * vatRate);
  return { subtotal, tax, total: round2(taxable + tax) };
}

/**
 * The VAT rate a quotation charged, recovered from its own figures, so an
 * amended order is taxed as the accepted quotation was rather than at a rate
 * that may have changed since.
 */
export function quotationVatRate(
  subtotal: number,
  tax: number,
  total: number,
): number {
  const taxable = total - tax;
  if (!(taxable > 0)) return 0;
  return Math.round((tax / taxable) * 1_000_000) / 1_000_000;
}
