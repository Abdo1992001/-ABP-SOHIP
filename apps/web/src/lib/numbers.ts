/**
 * Numbers that never print as garbage.
 *
 * `Intl` formats `NaN` happily — in English it says "NaN", and in Arabic it
 * says "ليس رقم" ("not a number"), which is how three of the KPI cards on the
 * sales dashboard came to read «ليس رقم EGP». The value was unusable either
 * way; the difference is whether the screen admits it with an em dash or
 * prints nonsense next to a currency code.
 *
 * `Number(value ?? fallback)` is the other half of the same bug: `??` only
 * catches `null` and `undefined`, so an empty string or a code where a decimal
 * was expected sails through and becomes `NaN` — and the carefully chosen
 * fallback beside it never applies. `toNum` applies the fallback whenever the
 * result would not be a finite number, which is what the author meant.
 */

/** The parsed number, or `fallback` whenever it would not be finite. */
export function toNum(value: unknown, fallback: number): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** The parsed number, or `null` when there isn't one — for "show a dash". */
export function asNum(value: unknown): number | null {
  const parsed = toNum(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export type NumLocale = "en" | "ar";

const intl = (locale: NumLocale) => (locale === "ar" ? "ar-EG" : "en");

/**
 * Format a number for display. Anything that is not a finite number comes back
 * as `dash` rather than as "NaN"/"ليس رقم".
 */
export function formatNum(
  value: unknown,
  locale: NumLocale,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 0 },
  dash = "—",
): string {
  const parsed = asNum(value);
  if (parsed === null) return dash;
  return parsed.toLocaleString(intl(locale), options);
}

/**
 * Money, with the currency code after the amount — the order the rest of the
 * app already uses, kept in one place so it cannot drift per screen.
 */
export function formatMoney(
  value: unknown,
  currency: string | null | undefined,
  locale: NumLocale,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 0 },
  dash = "—",
): string {
  const parsed = asNum(value);
  if (parsed === null) return dash;
  const amount = parsed.toLocaleString(intl(locale), options);
  const code = (currency ?? "").trim();
  return code === "" ? amount : `${amount} ${code}`;
}
