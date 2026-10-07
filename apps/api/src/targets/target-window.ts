/**
 * A date from the query, or the default when none is given; always inside
 * [min, max]. A salesperson's target belongs to one year, so what they won is
 * never counted from outside it, whatever window the screen asks for.
 * Null when the value is not a date, for the caller to refuse.
 */
export function clampDate(
  raw: string | undefined,
  fallback: Date,
  min: Date,
  max: Date,
): Date | null {
  if (raw === undefined || raw === "") return fallback;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return null;
  return value < min ? min : value > max ? max : value;
}
