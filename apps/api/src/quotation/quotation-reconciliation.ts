/**
 * Quotation reconciliation (spec SS24).
 *
 * The engineering side and the commercial side of a quotation are computed by
 * different code down different paths, and they are allowed to disagree only
 * in one direction: never. This module re-adds everything from the bottom up
 * and reports MATCH or CHECK, so a quotation cannot be issued on totals that
 * do not follow from its own lines.
 *
 * It compares already-rounded output, so plain numbers with an explicit
 * tolerance are the right tool -- a cent of drift across fifty lines is
 * rounding, and anything larger is a defect. Decimal arithmetic stays where
 * the money is actually computed.
 */

export type ReconciliationVerdict = "MATCH" | "CHECK";

export interface ReconciliationLine {
  lineNo: number;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  /** Pieces the engineering engine derived, when it derived any. */
  engineeredPieces?: number | null | undefined;
}

export interface ReconciliationInput {
  lines: readonly ReconciliationLine[];
  subtotal: number;
  adjustmentAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface ReconciliationCheck {
  code: string;
  verdict: ReconciliationVerdict;
  expected: number;
  actual: number;
  /** The line this is about, when it is about one line. */
  lineNo?: number;
}

export interface ReconciliationResult {
  verdict: ReconciliationVerdict;
  checks: ReconciliationCheck[];
}

/** One cent. Below this is rounding; at or above it is a disagreement. */
const MONEY_TOLERANCE = 0.01;

function compare(
  code: string,
  expected: number,
  actual: number,
  lineNo?: number,
): ReconciliationCheck {
  const verdict: ReconciliationVerdict =
    Math.abs(expected - actual) < MONEY_TOLERANCE ? "MATCH" : "CHECK";
  return lineNo === undefined
    ? { code, verdict, expected, actual }
    : { code, verdict, expected, actual, lineNo };
}

export function reconcileQuotation(
  input: ReconciliationInput,
): ReconciliationResult {
  const checks: ReconciliationCheck[] = [];

  for (const line of input.lines) {
    checks.push(
      compare(
        "LINE_TOTAL",
        line.qty * line.unitPrice - line.discountAmount,
        line.lineTotal,
        line.lineNo,
      ),
    );
    // What engineering says gets delivered is what the customer is charged
    // for. A quantity edited after the schedule was derived shows up here.
    if (line.engineeredPieces != null)
      checks.push(
        compare("QUOTED_PIECES", line.engineeredPieces, line.qty, line.lineNo),
      );
  }

  const lineSum = input.lines.reduce((sum, line) => sum + line.lineTotal, 0);
  checks.push(compare("SUBTOTAL", lineSum, input.subtotal));
  checks.push(
    compare(
      "GRAND_TOTAL",
      input.subtotal + input.adjustmentAmount + input.taxAmount,
      input.totalAmount,
    ),
  );

  return {
    verdict: checks.some((check) => check.verdict === "CHECK")
      ? "CHECK"
      : "MATCH",
    checks,
  };
}
