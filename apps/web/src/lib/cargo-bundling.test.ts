import { describe, expect, it } from "vitest";
import {
  boardsPerBundle,
  bundleLine,
  DEFAULT_BUNDLING,
  parseBoardDimensions,
  type BoardLine,
} from "./cargo-bundling.ts";

/**
 * The figures here come from real proformas in the archive, so a change that
 * breaks them is a change that would have quoted a different container count
 * for an order ABP has actually shipped.
 */

const board = (over: Partial<BoardLine> = {}): BoardLine => ({
  id: "B",
  description: "ACROW Board 15 mm x 1220 mm x 2440 mm (M- Board)",
  thicknessMm: 15,
  widthMm: 1220,
  lengthMm: 2440,
  densityKgM3: 600,
  unitWeightKg: 37.9542,
  quantity: 300,
  ...over,
});

describe("board dimensions from a description", () => {
  it("reads the house format", () => {
    expect(
      parseBoardDimensions("ACROW Board 15 mm x 1220 mm x 2440 mm (M- Board)"),
    ).toEqual({ thicknessMm: 15, widthMm: 1220, lengthMm: 2440 });
  });

  it("reads it with the millimetre mark against the digits", () => {
    expect(
      parseBoardDimensions(
        "ACROW Board 14.5mm x 882 mm x 1482 mm (M- Board) ( With Tie-Rod Holes) Bauframe",
      ),
    ).toEqual({ thicknessMm: 14.5, widthMm: 882, lengthMm: 1482 });
  });

  it("reads a comma as the decimal point, the way the invoices write it", () => {
    expect(
      parseBoardDimensions("ACROW Board 14.5mm x 682 mm x 537,5 mm (M- Board)"),
    ).toEqual({ thicknessMm: 14.5, widthMm: 682, lengthMm: 537.5 });
  });

  it("says nothing rather than guessing when there is no size in the text", () => {
    expect(parseBoardDimensions("Formwork accessories, assorted")).toBeNull();
  });
});

describe("bundling", () => {
  it("stops at the weight limit when the panel is heavy", () => {
    // 37.95kg net is 41.75kg gross; 1,500kg allows 35 boards. By height a
    // 15mm board would allow 66, so weight is what decides.
    const result = boardsPerBundle(board(), DEFAULT_BUNDLING);
    expect(result).toEqual({ count: 35, limitedBy: "WEIGHT" });
  });

  it("stops at the height limit when the panel is light", () => {
    // A 248mm-wide off-cut weighs 2.08kg, so 1,500kg would allow 654 of them —
    // the band gives out long before the forklift does.
    const result = boardsPerBundle(
      { thicknessMm: 14.5, unitWeightKg: 2.0846 },
      DEFAULT_BUNDLING,
    );
    expect(result).toEqual({ count: 68, limitedBy: "HEIGHT" });
  });

  it("keeps the remainder as a short bundle rather than rounding it away", () => {
    const group = bundleLine(board({ quantity: 300 }));

    expect(group.boardsPerBundle).toBe(35);
    expect(group.fullBundles).toBe(8);
    expect(group.remainderBoards).toBe(20);
    expect(group.bundleCount).toBe(9);
    // 8 × 35 + 20 is the 300 that were sold.
    expect(
      group.fullBundles * group.boardsPerBundle + group.remainderBoards,
    ).toBe(300);
  });

  it("makes exactly one bundle when the order divides evenly", () => {
    const group = bundleLine(board({ quantity: 35 }));

    expect(group.bundleCount).toBe(1);
    expect(group.remainderBoards).toBe(0);
  });

  it("carries the packing allowance into the bundle's weight", () => {
    const group = bundleLine(board({ quantity: 35 }));

    // 35 × 37.9542 = 1,328.40 net; the proformas run ~10% over that.
    expect(group.fullBundleWeightKg).toBeCloseTo(1461.24, 1);
    expect(group.fullBundleWeightKg).toBeLessThanOrEqual(
      DEFAULT_BUNDLING.maxBundleWeightKg,
    );
  });

  it("never produces a bundle of no boards, however heavy the panel", () => {
    const group = bundleLine(
      board({ unitWeightKg: 4000, quantity: 3, thicknessMm: 40 }),
    );

    expect(group.boardsPerBundle).toBe(1);
    expect(group.bundleCount).toBe(3);
  });

  it("respects a factory that bands shorter and lighter", () => {
    const tight = {
      ...DEFAULT_BUNDLING,
      maxBundleHeightMm: 600,
      maxBundleWeightKg: 800,
    };
    const result = boardsPerBundle(board(), tight);

    expect(result.count).toBe(19);
    expect(result.limitedBy).toBe("WEIGHT");
  });
});
