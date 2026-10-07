import { describe, expect, it } from "vitest";
import { reconcileQuotation } from "./quotation-reconciliation.js";

const line = {
  lineNo: 1,
  qty: 100,
  unitPrice: 3517.92,
  discountAmount: 0,
  lineTotal: 351792,
  engineeredPieces: 100,
};

describe("reconcileQuotation", () => {
  it("matches a quotation that adds up", () => {
    const result = reconcileQuotation({
      lines: [line],
      subtotal: 351792,
      adjustmentAmount: 0,
      taxAmount: 49250.88,
      totalAmount: 401042.88,
    });
    expect(result.verdict).toBe("MATCH");
  });

  it("catches a line total that does not follow from quantity and price", () => {
    const result = reconcileQuotation({
      lines: [{ ...line, lineTotal: 351000 }],
      subtotal: 351000,
      adjustmentAmount: 0,
      taxAmount: 49140,
      totalAmount: 400140,
    });
    expect(result.verdict).toBe("CHECK");
    expect(result.checks.find((c) => c.code === "LINE_TOTAL")?.verdict).toBe(
      "CHECK",
    );
  });

  it("catches a quantity edited away from the engineered piece count", () => {
    const result = reconcileQuotation({
      lines: [{ ...line, engineeredPieces: 120 }],
      subtotal: 351792,
      adjustmentAmount: 0,
      taxAmount: 0,
      totalAmount: 351792,
    });
    expect(result.checks.find((c) => c.code === "QUOTED_PIECES")?.verdict).toBe(
      "CHECK",
    );
  });

  it("catches a grand total that ignores the discount", () => {
    const result = reconcileQuotation({
      lines: [line],
      subtotal: 351792,
      adjustmentAmount: -35179.2,
      taxAmount: 44325.79,
      totalAmount: 401042.88,
    });
    expect(result.checks.find((c) => c.code === "GRAND_TOTAL")?.verdict).toBe(
      "CHECK",
    );
  });

  it("treats a cent of rounding as a match", () => {
    const result = reconcileQuotation({
      lines: [{ ...line, lineTotal: 351792.004 }],
      subtotal: 351792,
      adjustmentAmount: 0,
      taxAmount: 0,
      totalAmount: 351792,
    });
    expect(result.verdict).toBe("MATCH");
  });
});
