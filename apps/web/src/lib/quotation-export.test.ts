import { describe, expect, it } from "vitest";
import {
  documentRows,
  exportFileName,
  money,
  type QuotationExport,
} from "./quotation-export.ts";

/**
 * The figures below are quotation `0X-Sep-ABP-2026`: subtotal 1,372,747.11,
 * VAT 192,184.60, grand total 1,564,931.71. A change that alters what these
 * rows carry is a change to what a customer receives.
 */
const document: QuotationExport = {
  title: "Quotation",
  reference: "0X-Sep-ABP-2026",
  issuedOn: "27 September 2026",
  currency: "EGP",
  fields: [
    { label: "Customer", value: "Concord for Engineering and Contracting" },
    { label: "Subject", value: "ACROW Board" },
  ],
  lines: [
    {
      code: "2001030001001",
      description: "Acrow Board 18 mm x 1220 mm x 2440 mm ( M Board )",
      qty: 88,
      unit: "PCS",
      unitPrice: 3000,
      lineTotal: 264000,
    },
  ],
  subtotal: 1_372_747.11,
  discount: 0,
  vatLabel: "VAT (14%)",
  vat: 192_184.6,
  grandTotal: 1_564_931.71,
  amountInWords:
    "Egyptian Pounds One Million Five Hundred Sixty-Four Thousand Nine Hundred Thirty-One and Seventy-One Piastres Only",
  terms: ["Payment Terms: 100% in advance."],
  footNote: "Prices are valid for 7 days from the date of this quotation.",
};

describe("the rows every format is built from", () => {
  const rows = documentRows(document);

  it("opens with the document's own name", () => {
    expect(rows[0]).toEqual({ cells: ["Quotation"], kind: "TITLE" });
  });

  it("carries the header block in the workbook's order", () => {
    const fields = rows.filter((row) => row.kind === "FIELD");
    expect(fields[1]?.cells).toEqual([
      "Customer",
      "Concord for Engineering and Contracting",
    ]);
    expect(fields[2]?.cells[0]).toBe("Subject");
  });

  it("gives the lines a header row and then the lines", () => {
    const head = rows.find((row) => row.kind === "HEAD");
    expect(head?.cells).toEqual([
      "Item code",
      "Description",
      "Qty",
      "Unit",
      "Unit price",
      "Total",
    ]);
    const line = rows.find((row) => row.kind === "LINE");
    expect(line?.cells[0]).toBe("2001030001001");
    expect(line?.cells[5]).toBe(264000);
  });

  it("keeps the figures as numbers, so a spreadsheet can add them up", () => {
    const line = rows.find((row) => row.kind === "LINE");
    expect(typeof line?.cells[4]).toBe("number");
    const money = rows.filter((row) => row.kind === "MONEY");
    for (const row of money) expect(typeof row.cells[1]).toBe("number");
  });

  it("prints the money in the workbook's order", () => {
    const labels = rows
      .filter((row) => row.kind === "MONEY")
      .map((row) => row.cells[0]);
    expect(labels).toEqual(["Subtotal", "VAT (14%)", "Grand total"]);
  });

  it("shows a discount as the subtraction it is", () => {
    const discounted = documentRows({ ...document, discount: 45_000 });
    const row = discounted.find((one) => one.cells[0] === "Discount");
    expect(row?.cells[1]).toBe(-45_000);
  });

  it("leaves the discount line out when there is no discount", () => {
    expect(
      documentRows(document).some((row) => row.cells[0] === "Discount"),
    ).toBe(false);
  });

  it("repeats the amount in words, as the issued documents do", () => {
    const text = rows.filter((row) => row.kind === "TEXT");
    expect(text[0]?.cells[0]).toContain("Egyptian Pounds One Million");
  });

  it("carries the payment sentence verbatim", () => {
    const text = rows.filter((row) => row.kind === "TEXT");
    expect(text[1]?.cells[0]).toBe("Payment Terms: 100% in advance.");
  });
});

describe("the file a person ends up with", () => {
  it("is named after the quotation, not after the browser", () => {
    expect(exportFileName(document, "xlsx")).toBe("0X-Sep-ABP-2026.xlsx");
  });

  it("keeps a name a file system will accept", () => {
    expect(
      exportFileName({ ...document, reference: "A309/2026 rev 2" }, "docx"),
    ).toBe("A309-2026-rev-2.docx");
  });

  it("falls back to a name rather than producing a bare extension", () => {
    expect(exportFileName({ ...document, reference: "  " }, "pdf")).toBe(
      "quotation.pdf",
    );
  });
});

describe("how money is written", () => {
  it("always shows the minor unit, because a price does", () => {
    expect(money(2500)).toBe("2,500.00");
  });

  it("groups thousands the way the documents do", () => {
    expect(money(1_564_931.71)).toBe("1,564,931.71");
  });
});

describe("what reaches a customer's own spreadsheet", () => {
  it("rounds the money to the minor unit rather than shipping float noise", () => {
    // 2,500 x 14% is 350.00000000000006 in a double. A customer pasting that
    // into their sheet is reading our arithmetic error, not a price.
    const rows = documentRows({ ...document, vat: 350.00000000000006 });
    const vat = rows.find((row) => row.cells[0] === "VAT (14%)");
    expect(vat?.cells[1]).toBe(350);
  });

  it("never prints a status where an item code belongs", () => {
    // CODE_PENDING and CODED are how the studio talks to itself.
    const first = document.lines[0];
    if (first === undefined) throw new Error("fixture has no line");
    const rows = documentRows({ ...document, lines: [{ ...first, code: "" }] });
    const line = rows.find((row) => row.kind === "LINE");
    expect(line?.cells[0]).toBe("");
  });
});
