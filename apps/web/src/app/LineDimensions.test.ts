import { describe, expect, it } from "vitest";
import {
  dimensionFields,
  dimensionsComplete,
  usesFaces,
  type DimensionLine,
} from "./LineDimensions.tsx";

const line = (over: Partial<DimensionLine> = {}): DimensionLine => ({
  materialClass: "STANDARD",
  thicknessMm: "18",
  widthMm: "1220",
  lengthMm: "2440",
  sideAMm: "",
  sideBMm: "",
  columnHeightMm: "",
  diameterMm: "",
  faceWidthsMm: [],
  ...over,
});

const fieldsOf = (value: DimensionLine) =>
  dimensionFields(value).map((spec) => spec.field);

describe("dimensionFields", () => {
  it("asks a flat or curved board for thickness, width and length", () => {
    expect(fieldsOf(line())).toEqual(["thicknessMm", "widthMm", "lengthMm"]);
    expect(fieldsOf(line({ materialClass: "CURVED" }))).toEqual([
      "thicknessMm",
      "widthMm",
      "lengthMm",
    ]);
  });

  it("asks a rectangular column for its sides and height, not a board size", () => {
    // The panels are cut from the sides; a board width here would be the
    // wrong question.
    expect(fieldsOf(line({ materialClass: "REGULAR" }))).toEqual([
      "thicknessMm",
      "sideAMm",
      "sideBMm",
      "columnHeightMm",
    ]);
  });

  it("asks a circular column for its diameter and height", () => {
    expect(fieldsOf(line({ materialClass: "CIRCULAR" }))).toEqual([
      "thicknessMm",
      "diameterMm",
      "columnHeightMm",
    ]);
  });

  it("gives a core or a wall its height, the faces going to their own list", () => {
    for (const materialClass of ["CORE", "WALL"] as const)
      expect(fieldsOf(line({ materialClass }))).toEqual([
        "thicknessMm",
        "columnHeightMm",
      ]);
  });

  it("sends an irregular column to the face list too", () => {
    const irregular = line({
      materialClass: "REGULAR",
      columnShape: "IRREGULAR",
    });
    expect(usesFaces(irregular)).toBe(true);
    expect(fieldsOf(irregular)).toEqual(["thicknessMm", "columnHeightMm"]);
  });

  it("asks nothing of a line with no type yet", () => {
    expect(fieldsOf(line({ materialClass: "" }))).toEqual([]);
  });
});

describe("dimensionsComplete", () => {
  it("accepts a board with all three sizes", () => {
    expect(dimensionsComplete(line())).toBe(true);
  });

  it("wants every size a board is priced on", () => {
    expect(dimensionsComplete(line({ widthMm: "" }))).toBe(false);
    expect(dimensionsComplete(line({ lengthMm: "0" }))).toBe(false);
  });

  it("never holds a column up on its height, which has a company default", () => {
    expect(
      dimensionsComplete(
        line({ materialClass: "REGULAR", sideAMm: "400", sideBMm: "600" }),
      ),
    ).toBe(true);
  });

  it("wants a diameter from a circular column", () => {
    expect(dimensionsComplete(line({ materialClass: "CIRCULAR" }))).toBe(false);
    expect(
      dimensionsComplete(
        line({ materialClass: "CIRCULAR", diameterMm: "1000" }),
      ),
    ).toBe(true);
  });

  it("wants at least one face from a core", () => {
    expect(dimensionsComplete(line({ materialClass: "CORE" }))).toBe(false);
    expect(
      dimensionsComplete(
        line({ materialClass: "CORE", faceWidthsMm: ["", "900"] }),
      ),
    ).toBe(true);
  });

  it("is never complete without a type", () => {
    expect(dimensionsComplete(line({ materialClass: "" }))).toBe(false);
  });
});
