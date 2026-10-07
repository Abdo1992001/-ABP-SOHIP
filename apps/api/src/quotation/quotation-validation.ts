/**
 * Per-item validation status (spec SS23).
 *
 * The rule this module exists to enforce: DO NOT SILENTLY CALCULATE AN INVALID
 * ITEM. A line with a zero density still produces a number; that number is
 * zero, it looks like a price, and it goes out to a customer. So every line
 * carries an explicit status, the status is shown next to the line while it is
 * being entered, and a quotation with any CHECK on it cannot be issued.
 *
 * Statuses are codes, not prose, because they are stored in the line's price
 * snapshot and read back by both the API and the browser. The UI translates
 * them; nothing downstream parses English.
 *
 * Pure, mirrored verbatim in apps/web/src/lib/quotation-validation.ts.
 */

export type QuotationLineStatus =
  | "READY"
  | "CHECK_INPUT"
  | "CHECK_DIMENSIONS"
  | "CHECK_QUANTITY"
  | "CHECK_DENSITY"
  | "CHECK_PRICE"
  | "CHECK_FORMULA"
  | "ENTER_DIAMETER_OR_RADIUS"
  | "CHECK_DIAMETER_RADIUS_MISMATCH"
  | "CHECK_CALCULATION";

export interface QuotationLineIssue {
  status: QuotationLineStatus;
  /** The input this is about, so the panel can point at the field. */
  field: string;
}

export interface QuotationLineCheckInput {
  materialClass?: string | null | undefined;
  description?: string | null | undefined;
  quantity?: number | null | undefined;
  thicknessMm?: number | null | undefined;
  widthMm?: number | null | undefined;
  lengthMm?: number | null | undefined;
  heightMm?: number | null | undefined;
  densityKgM3?: number | null | undefined;
  appliedPricePerKg?: number | null | undefined;
  unitPrice?: number | null | undefined;
  diameterMm?: number | null | undefined;
  radiusMm?: number | null | undefined;
  columnHeightMm?: number | null | undefined;
  /** Set when a custom formula was selected but could not be evaluated. */
  formulaError?: boolean | undefined;
  /** Delivered pieces the engine produced, when it produces any. */
  totalPieces?: number | null | undefined;
}

const isPositive = (value: number | null | undefined): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Millimetres agree when they agree to the millimetre; drawings are not exact. */
const DIAMETER_RADIUS_TOLERANCE_MM = 1;

export function checkQuotationLine(input: QuotationLineCheckInput): {
  status: QuotationLineStatus;
  issues: QuotationLineIssue[];
} {
  const issues: QuotationLineIssue[] = [];
  const add = (status: QuotationLineStatus, field: string): void => {
    issues.push({ status, field });
  };

  if (!(input.description ?? "").trim()) add("CHECK_INPUT", "description");
  if (!isPositive(input.quantity)) add("CHECK_QUANTITY", "qty");
  if (input.formulaError === true) add("CHECK_FORMULA", "customFormula");

  const isCircular = input.materialClass === "CIRCULAR";
  const isDerived =
    typeof input.materialClass === "string" && input.materialClass.length > 0;

  if (isCircular) {
    const hasDiameter = isPositive(input.diameterMm);
    const hasRadius = isPositive(input.radiusMm);
    if (!hasDiameter && !hasRadius)
      add("ENTER_DIAMETER_OR_RADIUS", "diameterMm");
    // Both given is allowed - people copy a drawing that states both - but
    // they have to agree, or we do not know which one the column is.
    else if (
      hasDiameter &&
      hasRadius &&
      Math.abs((input.diameterMm ?? 0) - (input.radiusMm ?? 0) * 2) >
        DIAMETER_RADIUS_TOLERANCE_MM
    )
      add("CHECK_DIAMETER_RADIUS_MISMATCH", "radiusMm");
    if (!isPositive(input.columnHeightMm))
      add("CHECK_DIMENSIONS", "columnHeightMm");
  } else if (isDerived) {
    // Height carries the dimension for a column or a wall; width/length carry
    // it for a flat panel. One of the two pairs has to be there.
    const hasPanel = isPositive(input.widthMm) && isPositive(input.lengthMm);
    const hasHeightRun =
      isPositive(input.heightMm) && isPositive(input.lengthMm);
    if (!hasPanel && !hasHeightRun) add("CHECK_DIMENSIONS", "widthMm");
  }

  if (isDerived) {
    if (!isPositive(input.thicknessMm)) add("CHECK_DIMENSIONS", "thicknessMm");
    if (!isPositive(input.densityKgM3)) add("CHECK_DENSITY", "densityKgM3");
    if (!isPositive(input.appliedPricePerKg)) add("CHECK_PRICE", "pricePerKg");
    // An engine that ran and produced nothing to deliver has not really run.
    if (
      input.totalPieces !== undefined &&
      input.totalPieces !== null &&
      input.totalPieces <= 0
    )
      add("CHECK_CALCULATION", "totalPieces");
  } else if (!isPositive(input.unitPrice)) {
    // A manually priced line: nothing to derive, so the price is the input.
    add("CHECK_PRICE", "unitPrice");
  }

  return { status: issues[0]?.status ?? "READY", issues };
}

export function isBlockingStatus(status: QuotationLineStatus): boolean {
  return status !== "READY";
}

/** The quotation's own status: the worst of its lines. */
export function rollUpQuotationStatus(
  statuses: readonly QuotationLineStatus[],
): QuotationLineStatus {
  return statuses.find(isBlockingStatus) ?? "READY";
}
