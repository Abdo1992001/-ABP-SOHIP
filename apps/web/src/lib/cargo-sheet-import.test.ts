import { describe, expect, it } from "vitest";
import {
  findHeaderRow,
  importCargoSheet,
  mapColumns,
} from "./cargo-sheet-import.ts";

/**
 * ABP's own sheet puts the heading on row 9, under the logo and three lines of
 * notes. Everything below is written against that, and against the ways a
 * salesperson will have changed it by the time it comes back.
 */
const ABP_SHEET = [
  [],
  [],
  ["Fill one row per board size."],
  [],
  [],
  [],
  [],
  [],
  [
    "Item Code",
    "Description",
    "Thickness (mm)",
    "Width (mm)",
    "Length (mm)",
    "Density (kg/m3)",
    "Weight / board (kg)",
    "Quantity",
  ],
  [
    "2001030008403",
    "ACROW Board 18 mm × 1220 mm × 2440 mm ( M Board )",
    18,
    1220,
    2440,
    600,
    null,
    300,
  ],
];

describe("finding the table in somebody's spreadsheet", () => {
  it("finds the heading row under the logo and the notes", () => {
    expect(findHeaderRow(ABP_SHEET)).toBe(8);
  });

  it("finds it wherever it has been moved to", () => {
    const moved = [["something"], ...ABP_SHEET.slice(8)];
    expect(findHeaderRow(moved)).toBe(1);
  });

  it("says so rather than guessing when there is no heading row", () => {
    const result = importCargoSheet([["18"], ["1220"]]);
    expect(result.boards).toEqual([]);
    expect(result.problems[0]?.message).toContain("No heading row");
  });
});

describe("matching columns by what they are called", () => {
  it("reads ABP's own headings", () => {
    const mapped = mapColumns(ABP_SHEET[8] as string[]);
    expect(mapped.code).toBe(0);
    expect(mapped.description).toBe(1);
    expect(mapped.thicknessMm).toBe(2);
    expect(mapped.densityKgM3).toBe(5);
    expect(mapped.unitWeightKg).toBe(6);
    expect(mapped.quantity).toBe(7);
  });

  it("reads the short names a person types instead", () => {
    const mapped = mapColumns([
      "SKU",
      "Item",
      "T",
      "W",
      "L",
      "kg/m3",
      "kg/board",
      "Qty",
    ]);
    expect(mapped.thicknessMm).toBe(2);
    expect(mapped.lengthMm).toBe(4);
    expect(mapped.quantity).toBe(7);
  });

  it("does not let Weight claim the Weight / board column", () => {
    // Longest alias first, or "weight" takes the column "weight / board" is in
    // and the per-board figure is read as something else.
    const mapped = mapColumns(["Description", "Weight / board (kg)", "Qty"]);
    expect(mapped.unitWeightKg).toBe(1);
  });

  it("copes with the columns in a different order", () => {
    const mapped = mapColumns([
      "Qty",
      "Length",
      "Width",
      "Thickness",
      "Description",
    ]);
    expect(mapped.quantity).toBe(0);
    expect(mapped.description).toBe(4);
  });
});

describe("reading the boards", () => {
  it("reads ABP's own sheet", () => {
    const { boards, problems } = importCargoSheet(ABP_SHEET);
    expect(boards.length).toBe(1);
    expect(boards[0]).toMatchObject({
      code: "2001030008403",
      thicknessMm: 18,
      widthMm: 1220,
      lengthMm: 2440,
      densityKgM3: 600,
      quantity: 300,
    });
    expect(problems).toEqual([]);
  });

  it("leaves a blank weight blank, so the density does the work", () => {
    const { boards } = importCargoSheet(ABP_SHEET);
    expect(boards[0]?.unitWeightKg).toBe(0);
  });

  it("keeps a stated weight exactly as the sheet gave it", () => {
    const rows = [ABP_SHEET[8], [...(ABP_SHEET[9] as unknown[])]];
    (rows[1] as unknown[])[6] = 37.9542;
    const { boards } = importCargoSheet(rows as unknown[][]);
    expect(boards[0]?.unitWeightKg).toBe(37.9542);
  });

  it("reads a number somebody typed with a thousands separator", () => {
    const rows = [
      ABP_SHEET[8],
      ["", "Board", "18", "1,220", "2,440", "600", "", "50"],
    ];
    const { boards } = importCargoSheet(rows as unknown[][]);
    expect(boards[0]?.widthMm).toBe(1220);
    expect(boards[0]?.lengthMm).toBe(2440);
  });

  it("reads a size written with its unit against it", () => {
    const rows = [
      ABP_SHEET[8],
      ["", "Board", "18 mm", "1220 mm", "2440 mm", "600", "", "50"],
    ];
    const { boards } = importCargoSheet(rows as unknown[][]);
    expect(boards[0]?.thicknessMm).toBe(18);
  });

  it("skips the blank rows the template is full of", () => {
    const rows = [
      ABP_SHEET[8],
      ABP_SHEET[9],
      [],
      ["", "", "", "", "", 600, "", ""],
    ];
    const { boards, skipped } = importCargoSheet(rows as unknown[][]);
    expect(boards.length).toBe(1);
    expect(skipped).toBe(0);
  });
});

describe("what it refuses, and what it only warns about", () => {
  it("skips a row with no size and says which row", () => {
    const rows = [ABP_SHEET[8], ["", "A board", 0, 0, 0, 600, "", 50]];
    const { boards, problems, skipped } = importCargoSheet(rows as unknown[][]);
    expect(boards).toEqual([]);
    expect(skipped).toBe(1);
    expect(problems[0]?.row).toBe(2);
    expect(problems[0]?.severity).toBe("SKIPPED");
  });

  it("skips a row with no quantity, because it ships nothing", () => {
    const rows = [ABP_SHEET[8], ["", "A board", 18, 1220, 2440, 600, "", 0]];
    expect(importCargoSheet(rows as unknown[][]).skipped).toBe(1);
  });

  it("fills in a missing density and says it did", () => {
    const rows = [ABP_SHEET[8], ["", "A board", 18, 1220, 2440, "", "", 50]];
    const { boards, problems } = importCargoSheet(rows as unknown[][]);
    expect(boards[0]?.densityKgM3).toBe(600);
    expect(problems[0]?.severity).toBe("WARNING");
    expect(problems[0]?.message).toContain("600");
  });

  it("warns about a density no board has, and still imports it", () => {
    // 3,000 kg/m3 is a decimal point in the wrong place.
    const rows = [ABP_SHEET[8], ["", "A board", 18, 1220, 2440, 3000, "", 50]];
    const { boards, problems } = importCargoSheet(rows as unknown[][]);
    expect(boards.length).toBe(1);
    expect(problems[0]?.message).toContain("decimal point");
  });

  it("names a board that arrived without a description", () => {
    const rows = [ABP_SHEET[8], ["", "", 18, 1220, 2440, 600, "", 50]];
    const { boards } = importCargoSheet(rows as unknown[][]);
    expect(boards[0]?.description).toBe("18 × 1220 × 2440 mm");
  });

  it("points at the row a person sees in Excel", () => {
    const rows = [...ABP_SHEET, ["", "Bad", 0, 0, 0, 600, "", 5]];
    const { problems } = importCargoSheet(rows);
    // Eleven rows in, which is row 11 in the sheet.
    expect(problems[0]?.row).toBe(11);
  });
});

describe("a spreadsheet's holes", () => {
  it("survives a heading row with a gap in it", () => {
    // A spreadsheet row is sparse: a blank cell is a hole, not an empty
    // string, and a hole reaching the column matcher took the whole import
    // down on one blank cell.
    const headings: unknown[] = [];
    headings[0] = "Description";
    headings[3] = "Qty";
    expect(() => mapColumns(headings as string[])).not.toThrow();
    expect(mapColumns(headings as string[]).quantity).toBe(3);
  });

  it("reads a board from a row with holes around it", () => {
    const header: unknown[] = [];
    header[1] = "Description";
    header[2] = "Thickness";
    header[3] = "Width";
    header[4] = "Length";
    header[5] = "Qty";
    const data: unknown[] = [];
    data[1] = "A board";
    data[2] = 18;
    data[3] = 1220;
    data[4] = 2440;
    data[5] = 50;
    const { boards } = importCargoSheet([header, data] as unknown[][]);
    expect(boards.length).toBe(1);
    expect(boards[0]?.widthMm).toBe(1220);
  });
});
