/** The factory's production lines, as work orders name them. */
export const PRODUCTION_LINES = [
  { code: "LINE_1", en: "Line 1", ar: "خط 1" },
  { code: "LINE_2", en: "Line 2", ar: "خط 2" },
  { code: "LINE_3", en: "Line 3", ar: "خط 3" },
  { code: "CURVED_LINE", en: "Curved line", ar: "خط المنحني" },
] as const;

/**
 * The board categories the capacity rates are kept for. The server holds the
 * rates; this is only what to offer when the rates cannot be read.
 */
export const BOARD_CATEGORIES = ["STANDARD", "ORDINARY", "CURVED"] as const;

export function lineName(code: unknown, ar: boolean): string {
  const found = PRODUCTION_LINES.find((one) => one.code === code);
  if (found === undefined) return typeof code === "string" ? code : "—";
  return ar ? found.ar : found.en;
}
