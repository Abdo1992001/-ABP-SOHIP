import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  firstRowOf,
  insertRowsKeepingMerges,
  shiftRange,
} from "./xlsx-rows.ts";

describe("ranges", () => {
  it("moves a range down", () => {
    expect(shiftRange("J25:L26", 4)).toBe("J29:L30");
    expect(firstRowOf("B15:G15")).toBe(15);
    expect(shiftRange("nonsense", 4)).toBeNull();
  });
});

describe("inserting line rows in the quotation template", () => {
  it("carries the merges below the lines down with their cells", async () => {
    const book = new ExcelJS.Workbook();
    // Node's Buffer is what JSZip reads here; ExcelJS types it as the older one.
    await book.xlsx.load(
      readFileSync(
        "public/templates/abp-quotation.xlsx",
      ) as unknown as ArrayBuffer,
    );
    const sheet = book.worksheets[0];
    if (sheet === undefined) throw new Error("no sheet");
    const before = sheet.model.merges.filter((range) => firstRowOf(range) > 24);
    expect(before.length).toBeGreaterThan(0);

    insertRowsKeepingMerges(sheet, 24, 4);

    const after = new Set(sheet.model.merges);
    for (const range of before)
      expect(after.has(shiftRange(range, 4) ?? "")).toBe(true);
    // The new line rows are free to be merged the way the line rows are.
    for (let row = 25; row <= 28; row += 1) {
      expect(() => {
        sheet.mergeCells(`J${String(row)}:K${String(row)}`);
      }).not.toThrow();
    }
    await expect(book.xlsx.writeBuffer()).resolves.toBeTruthy();
  });
});
