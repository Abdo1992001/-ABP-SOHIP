/**
 * Matching a name read off a document to a customer already on the system.
 *
 * A quotation PDF names its client in prose — `Concord for Engineering &
 * Contracting`, `JV Rowad / CCC`, `Mark Safi` — and the system holds a
 * canonical name that may differ in case, punctuation, legal suffix or
 * spacing. This narrows the list to the plausible candidates.
 *
 * It **suggests**; it never selects on its own unless exactly one candidate
 * matches exactly. Everything else is put in front of a person, because
 * attaching a quotation to the wrong customer is not an error anyone
 * downstream would catch.
 */

/** Lower case, no punctuation, single spaces — for comparison only. */
export function normalizeName(value: string): string {
  return (
    value
      .toLowerCase()
      // A document prints `Concord for Engineering & Contracting` where the
      // record may hold `... and Contracting`. Dropping the ampersand as
      // punctuation makes those two names differ by a whole word, so it is
      // spelled out before punctuation is stripped.
      .replace(/&/g, " and ")
      // Arabic kashida is decoration inside a word, not a letter.
      .replace(/ـ/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ")
  );
}

/** The words worth matching on: the short ones carry no identity. */
function tokens(value: string): string[] {
  const skip = new Set([
    "for",
    "and",
    "the",
    "co",
    "company",
    "group",
    "ltd",
    "llc",
    "sae",
    "contracting",
    "engineering",
    "construction",
    "development",
  ]);
  return normalizeName(value)
    .split(" ")
    .filter((word) => word.length > 2 && !skip.has(word));
}

export interface NameCandidate<T> {
  item: T;
  /** 1 for an exact match after normalising, otherwise the token overlap. */
  score: number;
  exact: boolean;
}

/**
 * Candidates for `read`, best first, with anything below a real overlap left
 * out entirely — a list of near-misses is worse than a short list.
 */
export function matchName<T>(
  read: string,
  items: readonly T[],
  nameOf: (item: T) => string,
): NameCandidate<T>[] {
  const target = normalizeName(read);
  if (target === "") return [];
  const targetTokens = tokens(read);

  const scored: NameCandidate<T>[] = [];
  for (const item of items) {
    const name = nameOf(item);
    const normalized = normalizeName(name);
    if (normalized === "") continue;
    if (normalized === target) {
      scored.push({ item, score: 1, exact: true });
      continue;
    }
    const itemTokens = new Set(tokens(name));
    if (targetTokens.length === 0 || itemTokens.size === 0) continue;
    const shared = targetTokens.filter((word) => itemTokens.has(word)).length;
    if (shared === 0) continue;
    // Against the longer of the two, so a one-word name does not match
    // everything that happens to contain that word.
    const score = shared / Math.max(targetTokens.length, itemTokens.size);
    if (score >= 0.5) scored.push({ item, score, exact: false });
  }
  return scored.sort((left, right) => right.score - left.score);
}

/**
 * The one candidate safe to preselect: exactly one exact match and nothing
 * else. A single fuzzy match is still a guess, and is offered rather than
 * applied.
 */
export function soleExactMatch<T>(
  candidates: readonly NameCandidate<T>[],
): T | null {
  const exact = candidates.filter((candidate) => candidate.exact);
  return exact.length === 1 && exact[0] !== undefined ? exact[0].item : null;
}
