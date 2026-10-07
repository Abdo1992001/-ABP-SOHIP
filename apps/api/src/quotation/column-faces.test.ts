import { describe, expect, it } from "vitest";
import {
  columnFaceWidths,
  computeColumnPanelSchedule,
  MAX_ELEMENT_FACES,
} from "./column-faces.js";

/**
 * Fixtures are rows out of the ACROW BOARD workbook's own COLUMNS tab, so a
 * change here shows up as a disagreement with the sheet rather than as a
 * disagreement with an opinion.
 */
describe("columnFaceWidths", () => {
  it("laps the two closing panels on a square column (COL-001: 300 x 300)", () => {
    expect(
      columnFaceWidths({
        shape: "RECTANGULAR",
        sideAMm: 300,
        sideBMm: 300,
      }),
    ).toEqual([300, 300, 320, 320]);
  });

  it("keeps A and B in the order they were entered (COL-004 vs COL-022)", () => {
    expect(
      columnFaceWidths({ shape: "RECTANGULAR", sideAMm: 300, sideBMm: 600 }),
    ).toEqual([300, 600, 320, 620]);
    expect(
      columnFaceWidths({ shape: "RECTANGULAR", sideAMm: 600, sideBMm: 300 }),
    ).toEqual([600, 300, 620, 320]);
  });

  it("matches every rectangular size the workbook quotes", () => {
    const rows: [number, number, number[]][] = [
      [250, 250, [250, 250, 270, 270]],
      [250, 600, [250, 600, 270, 620]],
      [300, 450, [300, 450, 320, 470]],
      [300, 800, [300, 800, 320, 820]],
    ];
    for (const [a, b, expected] of rows) {
      expect(
        columnFaceWidths({ shape: "RECTANGULAR", sideAMm: a, sideBMm: b }),
      ).toEqual(expected);
    }
  });

  it("honours a closure allowance the company has changed", () => {
    expect(
      columnFaceWidths({
        shape: "RECTANGULAR",
        sideAMm: 300,
        sideBMm: 300,
        closureAllowanceMm: 25,
      }),
    ).toEqual([300, 300, 325, 325]);
  });

  it("takes an irregular column's faces off the drawing (COL-023)", () => {
    expect(
      columnFaceWidths({
        shape: "IRREGULAR",
        faceWidthsMm: [200, 700, 420, 200, 500, 220],
      }),
    ).toEqual([200, 700, 420, 200, 500, 220]);
  });

  it("returns nothing when a rectangular column is missing a dimension", () => {
    expect(
      columnFaceWidths({ shape: "RECTANGULAR", sideAMm: 300, sideBMm: 0 }),
    ).toEqual([]);
  });
});

describe("computeColumnPanelSchedule", () => {
  it("reproduces COL-001: four faces, eight panels across two columns", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "RECTANGULAR",
      sideAMm: 300,
      sideBMm: 300,
      quantity: 2,
      // No height split: one lift covers the whole column.
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.faceWidthsMm).toEqual([300, 300, 320, 320]);
    expect(schedule.totalFaceWidthMm).toBe(1240);
    expect(schedule.facesPerColumn).toBe(4);
    expect(schedule.totalFaces).toBe(8);
    expect(schedule.verticalCourses).toBe(1);
    expect(schedule.totalPanels).toBe(8);
  });

  it("splits a 4 m column into two 2 m lifts, doubling the panels", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "RECTANGULAR",
      sideAMm: 300,
      sideBMm: 300,
      quantity: 2,
      columnHeightMm: 4000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.verticalCourses).toBe(2);
    expect(schedule.courseLengthsMm).toEqual([2000, 2000]);
    expect(schedule.panelsPerColumn).toBe(8);
    expect(schedule.totalPanels).toBe(16);
    // Two distinct widths, four panels of each per column.
    expect(schedule.panels).toHaveLength(2);
    expect(schedule.panels[0]?.widthMm).toBe(320);
    expect(schedule.panels[0]?.countPerColumn).toBe(4);
    expect(schedule.panels[0]?.totalCount).toBe(8);
  });

  it("cuts the top lift to the remainder rather than a full panel", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "RECTANGULAR",
      sideAMm: 300,
      sideBMm: 300,
      quantity: 1,
      columnHeightMm: 4500,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.courseLengthsMm).toEqual([2000, 2000, 500]);
    expect(schedule.verticalCourses).toBe(3);
    expect(schedule.panelsPerColumn).toBe(12);
    expect(schedule.panels.some((panel) => panel.lengthMm === 500)).toBe(true);
    expect(schedule.panels.every((panel) => panel.totalCount > 0)).toBe(true);
  });

  it("splits a face wider than the maximum panel width", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [2500],
      quantity: 1,
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
      maxPanelWidthMm: 1220,
    });
    // 2500 = 1220 + 1220 + 60, exactly the workbook's MAX + REMAINDER rule.
    expect(
      schedule.panels.map((panel) => panel.widthMm).sort((a, b) => b - a),
    ).toEqual([1220, 60]);
    expect(schedule.panelsPerColumn).toBe(3);
  });

  it("reproduces COL-023: six faces off the drawing, twelve panels", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [200, 700, 420, 200, 500, 220],
      quantity: 2,
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.facesPerColumn).toBe(6);
    expect(schedule.totalFaces).toBe(12);
    expect(schedule.totalFaceWidthMm).toBe(2240);
    // 200 appears twice on the drawing, so it is two panels per column.
    const twoHundred = schedule.panels.find((panel) => panel.widthMm === 200);
    expect(twoHundred?.countPerColumn).toBe(2);
    expect(twoHundred?.totalCount).toBe(4);
  });

  it("matches the workbook's quoted count for the 200 mm panel", () => {
    // COL-023, qty 2, H 4000, max panel L 2000: the 200 mm face appears twice
    // per column, two columns, two lifts -> the workbook quotes 8.
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [200, 700, 420, 200, 500, 220],
      quantity: 2,
      columnHeightMm: 4000,
      maxPanelLengthMm: 2000,
    });
    expect(
      schedule.panels.find((panel) => panel.widthMm === 200)?.totalCount,
    ).toBe(8);
  });

  it("ignores faces past the sixth on an irregular column, and says so", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [100, 200, 300, 400, 500, 600, 700],
      quantity: 1,
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.facesPerColumn).toBe(6);
    expect(schedule.notes.join(" ")).toContain("at most 6 faces");
  });
});

/**
 * A core and a wall are the same engine on a bigger drawing: the workbook
 * gives both twenty face columns, a "Curved Faces" column and an
 * "Expected Faces" check.
 */
describe("cores and walls", () => {
  it("accepts twenty faces where a column accepts six", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => 100 + index * 10);
    expect(
      columnFaceWidths({
        shape: "IRREGULAR",
        faceWidthsMm: twenty,
        maxFaces: MAX_ELEMENT_FACES,
      }),
    ).toHaveLength(20);
    // The same drawing on a column keeps the column's own limit.
    expect(
      columnFaceWidths({ shape: "IRREGULAR", faceWidthsMm: twenty }),
    ).toHaveLength(6);
  });

  it("separates a curved panel from a flat one of the same size", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [600, 600],
      maxFaces: MAX_ELEMENT_FACES,
      curvedFaceNumbers: [2],
      quantity: 1,
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.curvedFaceCount).toBe(1);
    // Same 600 x 2000 millimetres, but two groups: one flat, one curved.
    expect(schedule.panels).toHaveLength(2);
    expect(schedule.panels.filter((panel) => panel.curved)).toHaveLength(1);
    expect(schedule.panelsPerColumn).toBe(2);
  });

  it("says so when the faces entered do not match the drawing", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [600, 600, 600],
      maxFaces: MAX_ELEMENT_FACES,
      expectedFaces: 4,
      quantity: 1,
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.notes.join(" ")).toContain("expected to have 4 faces");
    expect(schedule.notes.join(" ")).toContain("3 were entered");
  });

  it("stays quiet when the count is right", () => {
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [600, 600, 600, 600],
      maxFaces: MAX_ELEMENT_FACES,
      expectedFaces: 4,
      quantity: 1,
      columnHeightMm: 2000,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.notes).toEqual([]);
  });

  it("cuts a wall face wider than a panel into full panels and a remainder", () => {
    // A 5 m wall face on 1220 mm panels: four full and a 120 mm closer.
    const schedule = computeColumnPanelSchedule({
      shape: "IRREGULAR",
      faceWidthsMm: [5000],
      maxFaces: MAX_ELEMENT_FACES,
      quantity: 1,
      columnHeightMm: 4000,
      maxPanelWidthMm: 1220,
      maxPanelLengthMm: 2000,
    });
    expect(schedule.verticalCourses).toBe(2);
    // 5 panels across x 2 lifts.
    expect(schedule.panelsPerColumn).toBe(10);
    const widths = schedule.panels.map((panel) => panel.widthMm);
    expect(widths).toContain(1220);
    expect(widths).toContain(120);
  });
});
