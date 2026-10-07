/**
 * MASTER SETTINGS, as the ACROW BOARD workbook states them.
 *
 * The workbook is the authority for every quotation rule, and when it and a
 * written spec disagree the workbook is right. That is not a preference — it
 * is what the company prices from, and the spec document has been wrong twice:
 * it said 720 kg/m³ and 90 EGP/kg where the sheet says **600** and **77.76**.
 *
 * These lived as literals in two screens, which is how they drifted: the
 * wizard had been corrected to the workbook's rate and the studio had not, so
 * the same board could price differently depending on which screen you opened.
 * One module now, read by both.
 *
 * These are the *fallbacks*. What the company has actually stored in
 * `pricing_base_configs` wins; these apply when a field is absent, which is
 * why they have to be the workbook's numbers rather than plausible ones.
 *
 * Source: MASTER SETTINGS & DATA ENTRY RULES, tab `1697342984`.
 */

export const WORKBOOK = {
  /** Board thickness, mm. */
  thicknessMm: 18,
  /** Max panel width, mm — also the standard slab board width. */
  maxPanelWidthMm: 1220,
  /** Column / core / wall height, mm. */
  columnHeightMm: 4000,
  /** Standard slab board length, mm. */
  standardBoardLengthMm: 2440,
  /** Density, kg/m³. The sheet says 600; the old spec said 720. */
  densityKgM3: 600,
  /** Regular column closure allowance, mm. */
  closureAllowanceMm: 20,
  /** Max panel length, mm. */
  maxPanelLengthMm: 2000,
  /** Calculated standard board price, EGP per full reference board. */
  standardBoardPriceEgp: 2500,
  /**
   * Calculated standard price per kg, EGP.
   *
   * Carried at full precision rather than the 77.76 the sheet displays: it is
   * a derived figure (board price ÷ reference board weight) and rounding it
   * here would put every line a few piastres out against the workbook.
   */
  standardPricePerKg: 77.76185215045737,
  /** Default curved / circular M board price per kg, EGP. */
  curvedPricePerKg: 120,
  /** VAT, as a fraction. */
  vatRate: 0.14,
  /** Special discount, as a fraction. */
  discountRate: 0,
  /** Mould halves / segments on a curved column. */
  mouldSegments: 2,
  /** Arc module on the ground, mm. */
  arcModuleMm: 2440,
  /** Vertical course / lift, mm. */
  verticalCourseMm: 1200,
} as const;

/**
 * The reference board's weight, kg.
 *
 * The workbook prints 32.149 and marks it AUTO — it is width × length ×
 * thickness × density, not a number anyone types. Deriving it here keeps it
 * true when a company edits any of the four.
 */
export function referenceBoardWeightKg(
  widthMm: number = WORKBOOK.maxPanelWidthMm,
  lengthMm: number = WORKBOOK.standardBoardLengthMm,
  thicknessMm: number = WORKBOOK.thicknessMm,
  densityKgM3: number = WORKBOOK.densityKgM3,
): number {
  return (
    (widthMm / 1000) * (lengthMm / 1000) * (thicknessMm / 1000) * densityKgM3
  );
}

/**
 * Price per kg implied by a full-board price, and the reverse.
 *
 * The workbook holds both and keeps them in step: enter either and the other
 * follows. `2,500 EGP ÷ 32.149 kg = 77.76 EGP/kg` is the line it prints.
 */
export function pricePerKgFromBoard(
  boardPriceEgp: number,
  boardWeightKg: number,
): number {
  return boardWeightKg > 0 ? boardPriceEgp / boardWeightKg : 0;
}

export function boardPriceFromPerKg(
  pricePerKg: number,
  boardWeightKg: number,
): number {
  return pricePerKg * boardWeightKg;
}
