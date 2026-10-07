import { describe, expect, it } from "vitest";
import {
  boardPriceFromPerKg,
  pricePerKgFromBoard,
  referenceBoardWeightKg,
  WORKBOOK,
} from "./workbook-defaults.ts";

/**
 * Checked against the figures the workbook itself prints, so a change that
 * breaks these is a change that would quote a different price from the sheet
 * the company actually prices from.
 */

describe("workbook master settings", () => {
  it("derives the reference board weight the sheet shows as AUTO", () => {
    // 1.220 × 2.440 × 0.018 × 600 — the sheet prints 32.149.
    expect(referenceBoardWeightKg()).toBeCloseTo(32.149, 3);
  });

  it("derives the price per kg the sheet shows beside the board price", () => {
    const perKg = pricePerKgFromBoard(
      WORKBOOK.standardBoardPriceEgp,
      referenceBoardWeightKg(),
    );
    expect(perKg).toBeCloseTo(77.76, 2);
    expect(perKg).toBeCloseTo(WORKBOOK.standardPricePerKg, 6);
  });

  it("goes back the other way, which is what the override does", () => {
    // The sheet's own worked override: 2,368.42 EGP a board is 73.67 EGP/kg.
    const weight = referenceBoardWeightKg();
    const perKg = pricePerKgFromBoard(2368.42, weight);
    expect(perKg).toBeCloseTo(73.67, 2);
    expect(boardPriceFromPerKg(perKg, weight)).toBeCloseTo(2368.42, 2);
  });

  it("holds the density the sheet states, not the one the spec did", () => {
    // The spec document said 720. The sheet says 600 and the sheet wins.
    expect(WORKBOOK.densityKgM3).toBe(600);
  });

  it("holds the takeoff figures the sheet states", () => {
    expect(WORKBOOK.columnHeightMm).toBe(4000);
    expect(WORKBOOK.maxPanelLengthMm).toBe(2000);
    expect(WORKBOOK.maxPanelWidthMm).toBe(1220);
    expect(WORKBOOK.closureAllowanceMm).toBe(20);
  });

  it("holds the curved defaults the sheet states", () => {
    expect(WORKBOOK.curvedPricePerKg).toBe(120);
    expect(WORKBOOK.mouldSegments).toBe(2);
    expect(WORKBOOK.arcModuleMm).toBe(2440);
    expect(WORKBOOK.verticalCourseMm).toBe(1200);
  });

  it("has no weight, and no price, for a board of nothing", () => {
    expect(referenceBoardWeightKg(0, 2440, 18, 600)).toBe(0);
    expect(pricePerKgFromBoard(2500, 0)).toBe(0);
  });
});
