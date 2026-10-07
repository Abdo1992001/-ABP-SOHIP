/**
 * The figures and sentences both official documents are built from.
 *
 * ABP issues two documents off one quotation — a Quotation and a Proforma
 * Invoice — and they share most of their content. The parts that are easy to
 * get wrong by hand live here, computed once, so the screen preview, the PDF
 * and the Excel export cannot disagree with each other.
 *
 * Every rule below was read off ABP's own documents rather than invented:
 *
 *   - Instalments are percentages of the **grand total including VAT**. On
 *     quotation `0X-Sep-ABP-2026` the grand total is 1,564,931.71 and the
 *     advance reads 469,479.51, which is 30% of the grand total and not of
 *     the 1,372,747.11 subtotal.
 *   - A proforma's gross weight is the net weight plus a packing allowance.
 *     On `A309-2026` net 4,261.80528 kg becomes 4,687.985808 kg, which is
 *     exactly 10%.
 *   - The amount is repeated in words, in the document's own currency.
 */

/**
 * Packing over net weight on a proforma, as a percentage.
 *
 * Every proforma in the archive adds it: `A309-2026` reads 4,261.80528 kg net
 * and 4,687.985808 gross, which is exactly 10%. A container booked on net
 * weight is a container that fails at the weighbridge.
 */
export const PROFORMA_PACKING_PCT = 10;

export interface Instalment {
  /** Percentage of the grand total. */
  percent: number;
  /** Days after the delivery date. Zero means in advance. */
  daysAfterDelivery: number;
  amount: number;
}

export interface PaymentPlan {
  code: string;
  label: string;
  instalments: { percent: number; daysAfterDelivery: number }[];
}

/** The plans ABP actually issues. New ones are added, none are removed. */
export const PAYMENT_PLANS: PaymentPlan[] = [
  {
    code: "ADVANCE_100",
    label: "100% in advance",
    instalments: [{ percent: 100, daysAfterDelivery: 0 }],
  },
  {
    code: "30_35_35",
    label: "30% advance; 35% after 30 days from delivery; 35% after 60 days",
    instalments: [
      { percent: 30, daysAfterDelivery: 0 },
      { percent: 35, daysAfterDelivery: 30 },
      { percent: 35, daysAfterDelivery: 60 },
    ],
  },
  {
    code: "50_50",
    label: "50% advance, 50% after 30 days from delivery",
    instalments: [
      { percent: 50, daysAfterDelivery: 0 },
      { percent: 50, daysAfterDelivery: 30 },
    ],
  },
];

function money(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** A whole percentage reads as "30%", not "30.00%". */
function percent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function splitInstalments(
  plan: PaymentPlan,
  grandTotal: number,
): Instalment[] {
  return plan.instalments.map((part) => ({
    percent: part.percent,
    daysAfterDelivery: part.daysAfterDelivery,
    amount: (grandTotal * part.percent) / 100,
  }));
}

/**
 * The payment sentence, in ABP's own wording. Reproduced from the issued
 * documents rather than reworded, because a customer comparing two ABP
 * quotations should not find two ways of saying the same terms.
 */
export function paymentTermsSentence(
  plan: PaymentPlan,
  grandTotal: number,
): string {
  const parts = splitInstalments(plan, grandTotal);
  if (parts.length === 1 && parts[0] !== undefined)
    return `Payment Terms: ${percent(parts[0].percent)}% in advance.`;

  const phrases = parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    const amount = `(${money(part.amount)})`;
    if (part.daysAfterDelivery === 0)
      return `${percent(part.percent)}% in advance ${amount}`;
    const tail = `${percent(part.percent)}% ${amount} after ${String(part.daysAfterDelivery)} days from the delivery date`;
    return isLast ? `and the remaining ${tail}` : tail;
  });
  return `Payment Terms: ${phrases.join(", ")}.`;
}

/**
 * The gross weight a proforma declares: the boards themselves plus packing.
 *
 * The allowance is a percentage because it is a percentage on the documents —
 * 10% on `A309-2026` — and because a shipment packed differently needs a
 * different one without changing anything else.
 */
export function grossWeightKg(
  netWeightKg: number,
  packingPercent: number,
): number {
  return netWeightKg * (1 + packingPercent / 100);
}

/**
 * The commercial validity shown on the document is a duration, not the
 * internal expiry date. Date-only parsing avoids a browser timezone moving
 * either end by one day.
 */
export function offerValidityLabel(
  validFrom: string,
  expiresOn: string,
): string {
  const asUtcDay = (value: string): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (match === null) return null;
    const [, year, month, day] = match;
    const result = Date.UTC(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(result) ? null : result;
  };
  const start = asUtcDay(validFrom);
  const end = asUtcDay(expiresOn);
  if (start === null || end === null || end < start) return "";
  const days = Math.round((end - start) / 86_400_000);
  return `${String(days)} ${days === 1 ? "Day" : "Days"}`;
}

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function underThousand(value: number): string {
  if (value < 20) return ONES[value] ?? "";
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)] ?? "";
    const rest = value % 10;
    return rest === 0 ? tens : `${tens}-${ONES[rest] ?? ""}`;
  }
  const hundreds = `${ONES[Math.floor(value / 100)] ?? ""} Hundred`;
  const rest = value % 100;
  return rest === 0 ? hundreds : `${hundreds} ${underThousand(rest)}`;
}

function wholeInWords(value: number): string {
  if (value === 0) return "Zero";
  const groups: { size: number; name: string }[] = [
    { size: 1_000_000_000, name: "Billion" },
    { size: 1_000_000, name: "Million" },
    { size: 1_000, name: "Thousand" },
  ];
  let left = value;
  const words: string[] = [];
  for (const group of groups) {
    const count = Math.floor(left / group.size);
    if (count > 0) {
      words.push(`${underThousand(count)} ${group.name}`);
      left -= count * group.size;
    }
  }
  if (left > 0) words.push(underThousand(left));
  return words.join(" ");
}

export type DocumentCurrency = "USD" | "EGP";

const CURRENCY_WORDS: Record<
  DocumentCurrency,
  { major: string; minor: string }
> = {
  USD: { major: "US Dollars", minor: "Cents" },
  EGP: { major: "Egyptian Pounds", minor: "Piastres" },
};

/**
 * The amount repeated in words, as the proforma repeats it. Both documents
 * carry it; it was being typed by hand, which is where a figure and its words
 * come to disagree.
 */
export function amountInWords(
  amount: number,
  currency: DocumentCurrency,
): string {
  const names = CURRENCY_WORDS[currency];
  // Round to the minor unit first: 5590.331 is 5,590.33, and the words must
  // say what the figure beside them says.
  const cents = Math.round(amount * 100);
  const major = Math.floor(cents / 100);
  const minor = cents % 100;
  const head = `${names.major} ${wholeInWords(major)}`;
  if (minor === 0) return `${head} Only`;
  return `${head} and ${underThousand(minor)} ${names.minor} Only`;
}

/**
 * The instalments a payment term splits into, by the code the database holds.
 *
 * The terms themselves live in `payment_terms`, because the server refuses a
 * draft whose term is not a live row there — a list kept anywhere else drifts
 * from the one that decides whether a quotation can be saved. What the table
 * does not hold is the arithmetic: it stores the sentence a document prints,
 * not the percentages behind it. This is that arithmetic, and only for the
 * terms that have any.
 *
 * A term with no split returns null, which is the honest answer for a letter of
 * credit: it is a payment mechanism, not a schedule, and inventing instalments
 * for it would put figures on a quotation that nobody agreed.
 */
const TERM_PLANS: Record<string, PaymentPlan> = {
  CASH_IN_ADVANCE: {
    code: "CASH_IN_ADVANCE",
    label: "100% in advance",
    instalments: [{ percent: 100, daysAfterDelivery: 0 }],
  },
  ADVANCE_30_35_35: {
    code: "ADVANCE_30_35_35",
    label: "30% advance; 35% after 30 days from delivery; 35% after 60 days",
    instalments: [
      { percent: 30, daysAfterDelivery: 0 },
      { percent: 35, daysAfterDelivery: 30 },
      { percent: 35, daysAfterDelivery: 60 },
    ],
  },
  ADVANCE_50_BALANCE_ON_DELIVERY: {
    code: "ADVANCE_50_BALANCE_ON_DELIVERY",
    label: "50% advance, 50% on delivery",
    instalments: [
      { percent: 50, daysAfterDelivery: 0 },
      { percent: 50, daysAfterDelivery: 0 },
    ],
  },
  ADVANCE_50_BALANCE_BEFORE_DELIVERY: {
    code: "ADVANCE_50_BALANCE_BEFORE_DELIVERY",
    label: "50% advance, 50% before delivery",
    instalments: [
      { percent: 50, daysAfterDelivery: 0 },
      { percent: 50, daysAfterDelivery: 0 },
    ],
  },
  ADVANCE_25_BALANCE_ON_DELIVERY: {
    code: "ADVANCE_25_BALANCE_ON_DELIVERY",
    label: "25% advance, 75% on delivery",
    instalments: [
      { percent: 25, daysAfterDelivery: 0 },
      { percent: 75, daysAfterDelivery: 0 },
    ],
  },
  NET_30: {
    code: "NET_30",
    label: "Net 30 days",
    instalments: [{ percent: 100, daysAfterDelivery: 30 }],
  },
  NET_60: {
    code: "NET_60",
    label: "Net 60 days",
    instalments: [{ percent: 100, daysAfterDelivery: 60 }],
  },
  NET_90: {
    code: "NET_90",
    label: "Net 90 days",
    instalments: [{ percent: 100, daysAfterDelivery: 90 }],
  },
};

export function planForTerm(termCode: string): PaymentPlan | null {
  return TERM_PLANS[termCode] ?? null;
}
