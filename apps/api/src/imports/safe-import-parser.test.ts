/* eslint-disable @typescript-eslint/consistent-type-imports */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { parseImportFile } from "./safe-import-parser.js";

describe("safe ERP import parser", () => {
  it("parses quoted CSV without executing content", async () => {
    const file = Buffer.from(
      'orderNumber,countryCode,comment\nSO-1,EG,"safe, value"\n',
    );
    const parsed = await parseImportFile("orders.csv", "text/csv", file);
    expect(parsed.headers).toEqual(["orderNumber", "countryCode", "comment"]);
    expect(parsed.rows).toEqual([
      { orderNumber: "SO-1", countryCode: "EG", comment: "safe, value" },
    ]);
    expect(parsed.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("parses XLSX and rejects formulas", async () => {
    const ExcelJS = createRequire(import.meta.url)(
      "exceljs",
    ) as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Orders");
    sheet.addRow(["orderNumber", "countryCode"]);
    sheet.addRow(["SO-2", "AU"]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseImportFile(
      "orders.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    );
    expect(parsed.rows[0]).toEqual({ orderNumber: "SO-2", countryCode: "AU" });
    sheet.getCell("A2").value = {
      formula: 'HYPERLINK("https://evil.invalid")',
      result: "x",
    };
    const active = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(
      parseImportFile(
        "orders.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        active,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_XLSX_ACTIVE_CONTENT_REJECTED" });
  }, 30_000);

  it("rejects unsafe formats, duplicate columns, and size declarations", async () => {
    await expect(
      parseImportFile("orders.zip", "application/zip", Buffer.from("PK")),
    ).rejects.toMatchObject({ code: "IMPORT_FILE_TYPE_REJECTED" });
    await expect(
      parseImportFile("orders.csv", "text/csv", Buffer.from("id,ID\n1,2\n")),
    ).rejects.toMatchObject({ code: "IMPORT_HEADER_DUPLICATE" });
    await expect(
      parseImportFile("../orders.csv", "text/csv", Buffer.from("id\n1\n")),
    ).rejects.toMatchObject({ code: "IMPORT_FILENAME_REJECTED" });
    await expect(
      parseImportFile("orders.csv", "text/csv", Buffer.from("id\n=1+1\n")),
    ).rejects.toMatchObject({ code: "IMPORT_SPREADSHEET_FORMULA_REJECTED" });
  });
});
