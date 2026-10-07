import { describe, expect, it } from "vitest";
import {
  boardDescriptor,
  boardFamily,
  pieceGroupKey,
} from "./board-descriptor.js";

describe("boardDescriptor", () => {
  it("names a standard board thickness x width x length", () => {
    expect(
      boardDescriptor({
        materialClass: "STANDARD",
        thicknessMm: 18,
        widthMm: 1220,
        lengthMm: 2440,
      }),
    ).toBe("Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm (M Board)");
  });

  it("keeps a non-reference standard size in the same shape", () => {
    expect(
      boardDescriptor({
        materialClass: "STANDARD",
        thicknessMm: 18,
        widthMm: 1000,
        lengthMm: 2440,
      }),
    ).toBe("Acrow Board 18 mm \u00d7 1000 mm \u00d7 2440 mm (M Board)");
  });

  it("names a curved board with the curved family", () => {
    expect(
      boardDescriptor({
        materialClass: "CURVED",
        thicknessMm: 18,
        widthMm: 1885,
        lengthMm: 1200,
      }),
    ).toBe("Acrow Board 18 mm \u00d7 1885 mm \u00d7 1200 mm (M Board Curved)");
  });

  it("appends the diameter to a circular board without replacing its dimensions", () => {
    expect(
      boardDescriptor({
        materialClass: "CIRCULAR",
        thicknessMm: 18,
        widthMm: 1885,
        lengthMm: 1200,
        diameterMm: 1200,
      }),
    ).toBe(
      "Acrow Board 18 mm \u00d7 1885 mm \u00d7 1200 mm (M Board Curved) (D=1200 mm)",
    );
  });

  it("rounds a developed arc to whole millimetres", () => {
    expect(
      boardDescriptor({
        materialClass: "CIRCULAR",
        thicknessMm: 18,
        widthMm: 1884.9555921538758,
        lengthMm: 1200,
        diameterMm: 1200,
      }),
    ).toContain("1885 mm");
  });

  it("flags an item that delivers more than one cut size", () => {
    expect(
      boardDescriptor({
        materialClass: "CIRCULAR",
        thicknessMm: 18,
        widthMm: 2440,
        lengthMm: 1200,
        diameterMm: 5000,
        extraSizeCount: 1,
      }),
    ).toContain("(+1 size)");
  });

  it("sells circular as the curved family", () => {
    expect(boardFamily("CIRCULAR")).toBe("M Board Curved");
    expect(boardFamily("CORE")).toBe("M Board");
  });
});

describe("pieceGroupKey", () => {
  const base = {
    materialClass: "CIRCULAR" as const,
    thicknessMm: 18,
    widthMm: 1885,
    lengthMm: 1200,
    diameterMm: 1200,
    appliedPricePerKg: "120",
  };

  it("groups identical delivered pieces onto one key", () => {
    expect(pieceGroupKey(base)).toBe(pieceGroupKey({ ...base }));
  });

  it("separates pieces priced at different rates", () => {
    expect(pieceGroupKey(base)).not.toBe(
      pieceGroupKey({ ...base, appliedPricePerKg: "115" }),
    );
  });

  it("separates different diameters of the same delivered size", () => {
    expect(pieceGroupKey(base)).not.toBe(
      pieceGroupKey({ ...base, diameterMm: 1500 }),
    );
  });
});
