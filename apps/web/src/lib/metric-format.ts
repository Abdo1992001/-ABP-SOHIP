/**
 * Printing a governed metric so a person can read it.
 *
 * The analytics screen was rendering the value straight out of the envelope,
 * which is a decimal string carrying the full precision of the division that
 * produced it. Pipeline Aging read `9.49899942418981483056 Percent` and Stage
 * Value read `2900000 USD` — twenty digits in one card and no thousands
 * separator in the next, side by side on the screen this system exists to show
 * a manager.
 *
 * Precision is not accuracy here. A pipeline aged 9.499% is aged 9.5%; the
 * remaining eighteen digits are the arithmetic talking to itself. What the
 * reader needs is the figure at the resolution the decision is made at, and
 * the exact value stays in the envelope and in the export for anyone auditing
 * it.
 *
 * The units are the ones the registry actually emits — Count, Percent,
 * Quantity, Days, Score, Rate, kg, and the two currencies — and each is
 * rounded to what it is worth:
 *
 *   * **money** to whole units, because nobody reads a pipeline to the piastre,
 *     and with separators, because 2900000 and 29000000 are the same shape;
 *   * **percentages** to one decimal, which is where a percentage stops
 *     carrying information about a commercial figure;
 *   * **counts and quantities** as integers, since a third of an opportunity
 *     does not exist;
 *   * **days** to one decimal, because half a day of ageing is a real thing;
 *   * anything unrecognised to at most two decimals, so a unit added later is
 *     never printed raw.
 */

/** Units that are an amount of money rather than a measurement. */
const CURRENCIES = new Set(["USD", "EGP", "SAR", "AED", "EUR", "GBP"]);

/** How many decimals each unit is worth, by the unit's own name. */
const DECIMALS: Readonly<Record<string, number>> = {
  Count: 0,
  Quantity: 0,
  Percent: 1,
  Rate: 1,
  Days: 1,
  Score: 1,
  kg: 0,
};

export interface FormattedMetric {
  /** The number, grouped and rounded. */
  readonly value: string;
  /** What follows it: "USD", "%", "Count" — or "" when nothing should. */
  readonly suffix: string;
}

export function formatMetricValue(
  raw: string | number | null | undefined,
  unit: string | null | undefined,
  currency?: string | null,
  locale: "en" | "ar" = "en",
): FormattedMetric {
  const label = (currency ?? unit ?? "").trim();
  const numeric = typeof raw === "number" ? raw : Number((raw ?? "").trim());
  // A value that is not a number is not ours to reformat: show it as it came,
  // because it is more likely a code than a miscounted figure. The unit goes
  // with it -- "UNAVAILABLE %" is not a reading of anything.
  if (
    raw === null ||
    raw === undefined ||
    raw === "" ||
    !Number.isFinite(numeric)
  )
    return {
      value:
        raw === null || raw === undefined || raw === "" ? "—" : String(raw),
      suffix: "",
    };

  const decimals = CURRENCIES.has(label) ? 0 : (DECIMALS[label] ?? 2);
  // Arabic reads these figures in Latin digits throughout the app, so the
  // grouping locale is fixed rather than following the interface language.
  void locale;
  const value = numeric.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // A percentage wears its sign, not its name: "42.9%", not "42.9 Percent".
  const suffix = label === "Percent" ? "%" : label;
  return { value, suffix };
}

/** The whole thing as one string, for a card that prints it in one place. */
export function metricText(
  raw: string | number | null | undefined,
  unit: string | null | undefined,
  currency?: string | null,
): string {
  const { value, suffix } = formatMetricValue(raw, unit, currency);
  if (suffix === "") return value;
  // No space before a percent sign, one before a word or a currency code.
  return suffix === "%" ? `${value}%` : `${value} ${suffix}`;
}
