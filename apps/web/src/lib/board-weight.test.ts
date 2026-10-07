import { describe, expect, it } from "vitest";
import {
  boardVolumeM3,
  boardWeightKg,
  densityLooksWrong,
  impliedDensityKgM3,
} from "./board-weight.ts";

/**
 * The reference board the workbook prints: 1,220 × 2,440 × 18 mm at 600 kg/m³,
 * which it states as 32.149 kg and marks AUTO. A change that breaks this is a
 * change that disagrees with the sheet the company prices from.
 */
const reference = {
  thicknessMm: 18,
  widthMm: 1220,
  lengthMm: 2440,
  densityKgM3: 600,
};

describe("the weight of one board", () => {
  it("derives the workbook's own reference board", () => {
    expect(boardWeightKg(reference).kg).toBeCloseTo(32.149, 3);
  });

  it("says the figure was derived, not typed", () => {
    expect(boardWeightKg(reference).source).toBe("DERIVED");
  });

  it("follows the density when the factory changes it", () => {
    expect(boardWeightKg({ ...reference, densityKgM3: 720 }).kg).toBeCloseTo(
      38.579,
      3,
    );
  });

  it("uses a stated weight as given, because somebody stands behind it", () => {
    const found = boardWeightKg({ ...reference, statedKg: 37.95 });
    expect(found.kg).toBe(37.95);
    expect(found.source).toBe("STATED");
  });

  it("ignores a stated weight that is not a weight", () => {
    for (const stated of [0, -5, Number.NaN, null, undefined])
      expect(boardWeightKg({ ...reference, statedKg: stated }).source).toBe(
        "DERIVED",
      );
  });

  it("returns zero rather than a nonsense figure when a size is missing", () => {
    expect(boardWeightKg({ ...reference, widthMm: 0 }).kg).toBe(0);
  });
});

describe("the volume behind it", () => {
  it("works in cubic metres, not millimetres", () => {
    expect(boardVolumeM3(18, 1220, 2440)).toBeCloseTo(0.05358, 5);
  });
});

describe("checking a stated weight", () => {
  it("shows the density it implies, so a typo is visible", () => {
    expect(impliedDensityKgM3({ ...reference, statedKg: 32.149 })).toBeCloseTo(
      600,
      1,
    );
  });

  it("says nothing when there is no volume to divide by", () => {
    expect(
      impliedDensityKgM3({ ...reference, lengthMm: 0, statedKg: 10 }),
    ).toBeNull();
  });

  it("flags a density no board has", () => {
    // 3,000 kg/m3 is a decimal point in the wrong place, not a board.
    expect(densityLooksWrong(3000)).toBe(true);
    expect(densityLooksWrong(60)).toBe(true);
  });

  it("accepts the range ACROW's boards actually live in", () => {
    for (const density of [600, 720, 450, 1000])
      expect(densityLooksWrong(density)).toBe(false);
  });
});
