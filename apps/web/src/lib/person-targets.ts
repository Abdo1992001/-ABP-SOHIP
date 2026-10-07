/**
 * Each salesperson's target, and where they stand against it.
 *
 * The target is set for the year in EGP. A month or a quarter is judged
 * against its share of the year -- a twelfth, a quarter -- because a
 * salesperson looking at March should not see the whole year's number as what
 * they have left to do in March. What they won is counted by the server in the
 * same window, so the two sides of the comparison always cover the same time.
 */

export type PersonTarget = {
  userId: string;
  displayName: string;
  /** Null when no target has been set -- not the same as a target of zero. */
  targetEgp: number | null;
  wonEgp: number;
  pipelineEgp: number;
  openOpportunities: number;
};

export type TargetScope = "MONTH" | "QUARTER" | "YEAR" | "CUSTOM";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberOf = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The people from the endpoint's envelope; anything malformed is skipped. */
export function parsePeople(payload: unknown): PersonTarget[] {
  const rows =
    isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return rows.flatMap((row: unknown) => {
    if (!isRecord(row)) return [];
    if (typeof row.userId !== "string" || typeof row.displayName !== "string")
      return [];
    return [
      {
        userId: row.userId,
        displayName: row.displayName,
        targetEgp:
          row.targetEgp === null || row.targetEgp === undefined
            ? null
            : numberOf(row.targetEgp),
        wonEgp: numberOf(row.wonEgp),
        pipelineEgp: numberOf(row.pipelineEgp),
        openOpportunities: numberOf(row.openOpportunities),
      },
    ];
  });
}

const iso = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

/**
 * The window a scope covers, as whole months: [from, to) and how many months.
 * A custom range counts every month it touches, as the company target does.
 */
export function scopeWindow(
  scope: TargetScope,
  now: Date,
  customFrom?: string,
  customTo?: string,
): { from: string; to: string; months: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (scope === "MONTH")
    return { from: iso(year, month), to: iso(year, month + 1), months: 1 };
  if (scope === "QUARTER") {
    const start = Math.floor(month / 3) * 3;
    return { from: iso(year, start), to: iso(year, start + 3), months: 3 };
  }
  if (scope === "CUSTOM" && customFrom && customTo) {
    const a = new Date(`${customFrom}T00:00:00Z`);
    const b = new Date(`${customTo}T00:00:00Z`);
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b >= a) {
      const first = a.getUTCFullYear() === year ? a.getUTCMonth() : 0;
      const last = b.getUTCFullYear() === year ? b.getUTCMonth() : 11;
      if (last >= first)
        return {
          from: iso(year, first),
          to: iso(year, last + 1),
          months: last - first + 1,
        };
    }
  }
  return { from: iso(year, 0), to: iso(year + 1, 0), months: 12 };
}

/** One person against their share of the year for the window. */
export function personStanding(person: PersonTarget, months: number) {
  const target =
    person.targetEgp === null ? null : (person.targetEgp * months) / 12;
  const achievedPct =
    target !== null && target > 0
      ? Math.min(999, (person.wonEgp / target) * 100)
      : 0;
  return {
    target,
    won: person.wonEgp,
    remaining: target === null ? null : Math.max(0, target - person.wonEgp),
    achievedPct,
    pipeline: person.pipelineEgp,
    openOpportunities: person.openOpportunities,
  };
}

/**
 * Who "View as Sales User" shows when nobody has been picked: the first person
 * with something to show, so the preview opens on real figures.
 */
export function defaultPreviewPerson(
  people: PersonTarget[],
): PersonTarget | null {
  return (
    people.find((p) => p.wonEgp > 0 || p.openOpportunities > 0) ??
    people[0] ??
    null
  );
}
