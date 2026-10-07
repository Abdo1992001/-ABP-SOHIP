/**
 * Customer feedback rules, pure so they are tested without Nest.
 *
 * A customer does not log in to give feedback. They say who they are, how to
 * reach them, and something that ties them to us -- an order number, a
 * quotation or proforma number, an item code. The reference is what routes
 * the feedback to the salesperson who knows them.
 */

export const FEEDBACK_KINDS = [
  "SATISFACTION",
  "PROBLEM",
  "SUGGESTION",
  "QUESTION",
] as const;
export const REFERENCE_TYPES = [
  "ORDER",
  "QUOTATION",
  "PROFORMA",
  "ITEM_CODE",
  "OTHER",
] as const;
export const CONTACT_CHANNELS = ["PHONE", "WHATSAPP", "EMAIL"] as const;
export const FEEDBACK_STATUSES = [
  "NEW",
  "ACKNOWLEDGED",
  "CONTACTED",
  "CLOSED",
] as const;

const NEXT: Record<string, readonly string[]> = {
  NEW: ["ACKNOWLEDGED", "CONTACTED", "CLOSED"],
  ACKNOWLEDGED: ["CONTACTED", "CLOSED"],
  CONTACTED: ["CLOSED"],
  CLOSED: [],
};

export function canFollowUp(from: string, to: string): boolean {
  return (NEXT[from] ?? []).includes(to);
}

/** Upper-case, single-spaced, without the punctuation people add around refs. */
export function normaliseReference(value: string): string {
  return value
    .trim()
    .replace(/^[#:\s]+|[.,;:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Feedback becomes a complaint when the customer says it is critical, or
 * when it is a problem rated two stars or fewer: an unhappy customer with a
 * problem should not wait in a feedback inbox.
 */
export function needsComplaint(input: {
  kindCode: string;
  critical: boolean;
  rating: number | null;
}): boolean {
  if (input.critical) return true;
  return (
    input.kindCode === "PROBLEM" && input.rating !== null && input.rating <= 2
  );
}

export function complaintSeverity(input: {
  critical: boolean;
  rating: number | null;
}): string {
  if (input.critical) return "CRITICAL";
  return input.rating !== null && input.rating <= 1 ? "HIGH" : "MEDIUM";
}

/** A phone number as dialled from Egypt, for a tel: or WhatsApp link. */
export function dialable(phone: string | null): string | null {
  if (phone === null) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits === "") return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

/**
 * Customer satisfaction over a set of ratings: the average, and the share of
 * 4s and 5s (the usual CSAT figure). Unrated feedback does not count.
 */
export function satisfaction(ratings: readonly (number | null)[]): {
  responses: number;
  average: number | null;
  csatPct: number | null;
  distribution: number[];
} {
  const rated = ratings.filter(
    (value): value is number => value !== null && value >= 1 && value <= 5,
  );
  const distribution = [1, 2, 3, 4, 5].map(
    (star) => rated.filter((value) => value === star).length,
  );
  if (rated.length === 0)
    return { responses: 0, average: null, csatPct: null, distribution };
  const average = rated.reduce((sum, value) => sum + value, 0) / rated.length;
  const happy = rated.filter((value) => value >= 4).length;
  return {
    responses: rated.length,
    average: Math.round(average * 100) / 100,
    csatPct: Math.round((happy / rated.length) * 1000) / 10,
    distribution,
  };
}
