import { describe, expect, it } from "vitest";
import {
  pieceAreaM2,
  pieceWeightKg,
  referenceBasis,
  technicalSummary,
} from "./quotation-technical-summary.ts";
import type { GeneratedPiece } from "./quotation-consolidation.ts";

const piece = (patch: Partial<GeneratedPiece> = {}): GeneratedPiece => ({
  sourceLabel: "Core 01",
  materialClass: "STANDARD",
  thicknessMm: 18,
  widthMm: 1220,
  lengthMm: 2440,
  densityKgM3: 600,
  qty: 1,
  unitPrice: 2500,
  currencyCode: "EGP",
  ...patch,
});

describe("the reference board, every way it is argued", () => {
  // The workbook's own figures: 1220 x 2440 x 18 at 600 kg/m3, 2,500 EGP.
  const basis = referenceBasis({
    widthMm: 1220,
    lengthMm: 2440,
    thicknessMm: 18,
    densityKgM3: 600,
    boardPrice: 2500,
  });

  it("states the area the sheet states", () => {
    expect(basis.areaM2).toBeCloseTo(2.9768, 4);
  });

  it("states the weight the sheet states", () => {
    expect(basis.weightKg).toBeCloseTo(32.14944, 5);
  });

  it("converts to the rate per kilogram the sheet prints", () => {
    expect(basis.pricePerKg).toBeCloseTo(77.7619, 4);
  });

  it("converts to the rate per square metre, which nobody had", () => {
    // 2500 / 2.9768 — the figure a customer comparing suppliers asks for.
    expect(basis.pricePerM2).toBeCloseTo(839.83, 2);
  });

  it("has no rate for a board of nothing, rather than dividing by zero", () => {
    const empty = referenceBasis({
      widthMm: 0,
      lengthMm: 2440,
      thicknessMm: 18,
      densityKgM3: 600,
      boardPrice: 2500,
    });
    expect(empty.pricePerKg).toBe(0);
    expect(empty.pricePerM2).toBe(0);
  });
});

describe("one board", () => {
  it("has the area and weight the workbook derives", () => {
    expect(pieceAreaM2(piece())).toBeCloseTo(2.9768, 4);
    expect(pieceWeightKg(piece())).toBeCloseTo(32.14944, 5);
  });
});

describe("what the quotation supplies", () => {
  it("adds up pieces, area and weight across every scope", () => {
    const summary = technicalSummary(
      [piece({ qty: 10 }), piece({ qty: 5 })],
      2,
    );
    expect(summary.elements).toBe(2);
    expect(summary.finishedPieces).toBe(15);
    expect(summary.totalAreaM2).toBeCloseTo(2.9768 * 15, 3);
    expect(summary.totalWeightKg).toBeCloseTo(32.14944 * 15, 3);
  });

  it("counts an element once however many boards it makes", () => {
    // One column producing eight panels is one element and eight pieces.
    const summary = technicalSummary(
      [piece({ qty: 6 }), piece({ widthMm: 600, qty: 2 })],
      1,
    );
    expect(summary.elements).toBe(1);
    expect(summary.finishedPieces).toBe(8);
  });

  it("splits the totals by family", () => {
    const summary = technicalSummary(
      [
        piece({ qty: 10 }),
        piece({ materialClass: "CURVED", qty: 4 }),
        piece({ materialClass: "CIRCULAR", qty: 6 }),
      ],
      3,
    );
    expect(summary.byFamily.map((entry) => entry.family)).toEqual([
      "STANDARD",
      "CURVED",
      "CIRCULAR",
    ]);
    expect(summary.byFamily[1]?.totals.pieces).toBe(4);
    expect(summary.byFamily[2]?.totals.pieces).toBe(6);
  });

  it("shows only the families the quotation actually contains", () => {
    const summary = technicalSummary([piece({ qty: 3 })], 1);
    expect(summary.byFamily).toHaveLength(1);
    expect(summary.byFamily[0]?.family).toBe("STANDARD");
  });

  it("ignores a scope that generated nothing", () => {
    const summary = technicalSummary([piece({ qty: 0 })], 1);
    expect(summary.finishedPieces).toBe(0);
    expect(summary.byFamily).toEqual([]);
  });

  it("keeps the family split adding to the total", () => {
    const pieces = [
      piece({ qty: 10 }),
      piece({ materialClass: "CURVED", widthMm: 900, qty: 4 }),
    ];
    const summary = technicalSummary(pieces, 2);
    const summed = summary.byFamily.reduce(
      (sum, entry) => sum + entry.totals.weightKg,
      0,
    );
    expect(summed).toBeCloseTo(summary.totalWeightKg, 6);
  });
});
