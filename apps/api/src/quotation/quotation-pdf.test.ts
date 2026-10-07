import { describe, expect, it } from "vitest";
import {
  parseQuotationDocument,
  parseQuotationLine,
  reconcilesWithPrintedTotal,
} from "./quotation-pdf.js";

/**
 * Every string below is a real row, copied from the text of an actual
 * quotation in the sample folder. They are here because they are the rows
 * that broke an earlier version of this parser — between them they cover the
 * five table layouts the 167 documents actually use.
 */

describe("reading a price row", () => {
  it("reads the plain three-column row", () => {
    const row = parseQuotationLine(
      "1 Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board ) 88 3000.00 264,000.00",
    );
    expect(row).toEqual({
      description: "Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board )",
      qty: 88,
      unitPrice: 3000,
      lineTotal: 264000,
    });
  });

  it("takes the quantity that makes the arithmetic true, not the one in the middle column", () => {
    // QTY m² 1000 | QTY 336 | UNIT 4242.90 | TOTAL 1,425,614.40.
    // 336 x 4242.90 is the total; 1000 x 4242.90 is not. Reading by position
    // took the square metres as the quantity on a third of the folder.
    const row = parseQuotationLine(
      "L  = 100m , H= 5m Acrow Board 18 mm × 1220 × 2440 mm ( M Board ) 1000 336 4242.90 1,425,614.40",
    );
    expect(row?.qty).toBe(336);
    expect(row?.unitPrice).toBe(4242.9);
    expect(row?.lineTotal).toBe(1425614.4);
  });

  it("reads the nesting-allowance layout, where the second quantity is the priced one", () => {
    const row = parseQuotationLine(
      "A=390 M² Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board ) 132 146 3641.00 531,586.00",
    );
    expect(row?.qty).toBe(146);
    expect(row?.lineTotal).toBe(531586);
  });

  it("recovers a quantity printed hard against the text before it", () => {
    // "HOLES40" is "HOLES" and a quantity of 40 with the column gap lost.
    const row = parseQuotationLine(
      "1 ACROW BOARD 18 MM × 991 MM × 2982 MM (M BOARD) WITHOUT TIE ROD HOLES40 87.77 79.00 3,160.00",
    );
    expect(row?.qty).toBe(40);
    expect(row?.unitPrice).toBe(79);
    expect(row?.lineTotal).toBe(3160);
  });

  it("stops at the net total when the row carries its own VAT", () => {
    // ... D=0.72 | 38 | 4252.50 | 161,595.00 | 22,623.30 | 184,218.30
    // The last number is the total including tax. Taking it as the line total
    // would count the VAT twice against a subtotal computed before it.
    const row = parseQuotationLine(
      "1 Acrow Board 15 mm × 3500 mm × 1250 mm  ( M Board Gray  ) D=0.7238 4252.50 161595.00 22623.30 184,218.30",
    );
    expect(row?.qty).toBe(38);
    expect(row?.unitPrice).toBe(4252.5);
    expect(row?.lineTotal).toBe(161595);
  });

  it("refuses a row with a discount column rather than inventing a quantity", () => {
    // qty 1 | list 3200 | after discount 2880 | VAT 403.20 | 3283.20.
    // No reading of these columns is qty x unit = total, and a quotation
    // imported with a made-up quantity would never be flagged again.
    expect(
      parseQuotationLine(
        "1 Acrow Board 18 mm × 1220 mm × 2440 mm  ( M Board Wood Pattern  ) D=0.72 1 3200.00 2880.00 403.20 3283.20",
      ),
    ).toBeNull();
  });

  it("refuses a row that is simply not a priced item", () => {
    expect(
      parseQuotationLine(
        "2 Transportation (CIF) to the Port of Tema, Ghana 40 F T  Contanier 3496",
      ),
    ).toBeNull();
    expect(
      parseQuotationLine("Acrow Board 18 mm × 1220 mm × 2440 mm"),
    ).toBeNull();
  });

  it("does not drop a trailing pair that is not tax", () => {
    // 100 x 3.00 = 300, and 300 + 50 is not 400, so nothing is dropped and
    // the row reads by its own last two columns.
    const row = parseQuotationLine("1 Something 50 400 100 3.00 300.00");
    expect(row?.qty).toBe(100);
    expect(row?.lineTotal).toBe(300);
  });
});

const DOCUMENT = [
  "أكـرو لمنتجات البناء",
  "Quotation  001-NOV-ABP-2025 Tuesday, December 16, 2025",
  "Client Name: Concord for Engineering & Contracting",
  "Project Name: (General use )",
  "Attn: Eng / Ahmed Fekry",
  "Sales Engineer: Eng . Nabil Emad   - +20 1029869858",
  "Subject: Acrow M Board",
  "C - ACROW M BOARDS PRICES : ",
  "# Item Desc QTY. UNITE PRICE TOTAL PRICE (EGP) ",
  "EXCLUDING VAT%",
  "1 Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board ) 88 3000.00 264,000.00",
  "2 Acrow Curved Board 18 mm × 1000 mm × 2000 mm ( M Board ) 64 3888.00 248,832.00",
  "512,832.00",
  "71,796.48",
  "584,628.48",
  "Total",
  "Vat (14%)",
  "Grand Total",
  "Payment: 100 % in advance",
  "OFFER VALIDATION 7 DAYS",
  "Delivery Time: ACCORDING TO AN AGREED TIME SCHEDULE",
].join("\n");

describe("reading a whole quotation", () => {
  it("reads the header the document repeats on every page", () => {
    const doc = parseQuotationDocument(DOCUMENT);
    expect(doc.quoteRef).toBe("001-NOV-ABP-2025");
    expect(doc.quoteDate).toBe("Tuesday, December 16, 2025");
    expect(doc.clientName).toBe("Concord for Engineering & Contracting");
    expect(doc.attention).toBe("Eng / Ahmed Fekry");
    expect(doc.subject).toBe("Acrow M Board");
  });

  it("reads both items and totals them to what the document printed", () => {
    const doc = parseQuotationDocument(DOCUMENT);
    expect(doc.lines).toHaveLength(2);
    expect(doc.subtotal).toBeCloseTo(512832, 2);
    expect(doc.unreconciledRows).toEqual([]);
  });

  it("keeps the terms printed under the table", () => {
    const doc = parseQuotationDocument(DOCUMENT);
    expect(doc.terms).toContainEqual({
      label: "Payment",
      value: "100 % in advance",
    });
    expect(doc.terms).toContainEqual({
      label: "OFFER VALIDATION",
      value: "7 DAYS",
    });
  });

  it("does not read the totals block as another item", () => {
    const doc = parseQuotationDocument(DOCUMENT);
    for (const line of doc.lines) expect(line.description).not.toBe("");
  });

  it("handles a document with several price tables", () => {
    const twoTables = [
      "Heavy Duty Trusses Item Desc QTY. QTY after adding 10% UNITE PRICE TOTAL PRICE (EGP)",
      "A=390 M² Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board ) 132 146 3641.00 531,586.00",
      "Total",
      "X-Beam &Soldier System Item Desc QTY. QTY after adding 10% UNITE PRICE TOTAL PRICE (EGP)",
      "Core 01   - A=122.20 M² Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board ) 42 47 3641.00 171,127.00",
      "Total",
    ].join("\n");
    const doc = parseQuotationDocument(twoTables);
    expect(doc.lines).toHaveLength(2);
    expect(doc.subtotal).toBeCloseTo(702713, 2);
  });

  it("returns an empty reading rather than throwing on a document with no table", () => {
    const doc = parseQuotationDocument(
      "Acrow eco form brochure\nno prices here",
    );
    expect(doc.lines).toEqual([]);
    expect(doc.subtotal).toBe(0);
  });
});

/**
 * How the geometric text extraction actually presents a wrapped cell: the
 * halves land on their own baselines, above and below the priced row, because
 * the cell's text is centred against it. This is the real shape of
 * `001-NOV-ABP-2025`, and it is what left an imported line with an empty
 * description until the halves were reattached.
 */
const WRAPPED = [
  "C - ACROW M BOARDS PRICES :",
  "TOTAL PRICE (EGP)",
  "# Item Desc QTY. UNITE PRICE",
  "EXCLUDING VAT%",
  "1 Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board ) 88 3000.00 264,000.00",
  "Acrow Curved Board 18 mm × 1000 mm × 2000 mm ( M",
  "2 64 3888.00 248,832.00",
  "Board )",
  "Total 512,832.00",
  "Vat (14%) 71,796.48",
  "Grand Total 584,628.48",
].join("\n");

describe("a description that wrapped out of its cell", () => {
  it("puts the halves back on the row they belong to", () => {
    const doc = parseQuotationDocument(WRAPPED);
    expect(doc.lines[1]?.description).toBe(
      "Acrow Curved Board 18 mm × 1000 mm × 2000 mm ( M Board )",
    );
    expect(doc.lines[1]?.qty).toBe(64);
  });

  it("does not read the table's own heading as a description", () => {
    const doc = parseQuotationDocument(WRAPPED);
    expect(doc.lines[0]?.description).toBe(
      "Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board )",
    );
  });

  it("does not report a wrapped half as a row that failed to reconcile", () => {
    // "Acrow Curved Board 18 mm × 1000 mm × 2000 mm ( M" carries three
    // numbers and words, but it does not end in a figure, so it is half a
    // description rather than a broken price row.
    expect(parseQuotationDocument(WRAPPED).unreconciledRows).toEqual([]);
  });

  it("keeps the totals the document printed, beside its own figure", () => {
    const doc = parseQuotationDocument(WRAPPED);
    expect(doc.printedTotals).toContainEqual({ label: "total", value: 512832 });
    expect(doc.subtotal).toBeCloseTo(512832, 2);
    expect(reconcilesWithPrintedTotal(doc)).toBe(true);
  });

  it("says so when the lines read do not add up to the printed total", () => {
    // A document whose table carries a row this parser cannot read prints a
    // total larger than the rows it could. That gap is the whole point of the
    // check, so it is stated here with the printed figure left alone and one
    // row removed.
    const missingRow = WRAPPED.split("\n")
      .filter((line) => !line.startsWith("2 64 3888.00"))
      .join("\n");
    const doc = parseQuotationDocument(missingRow);
    expect(doc.lines).toHaveLength(1);
    expect(reconcilesWithPrintedTotal(doc)).toBe(false);
  });

  it("has no verdict on a document that printed no total", () => {
    expect(
      reconcilesWithPrintedTotal(parseQuotationDocument("nothing here")),
    ).toBeNull();
  });
});

describe("a document that prints no reference", () => {
  it("does not store the weekday as the quotation number", () => {
    // `mark safi.pdf` prints "Quotation  Thursday, April 16, 2026" and no
    // reference at all. The weekday was being kept as the quote ref.
    const doc = parseQuotationDocument(
      "Quotation  Thursday, April 16, 2026\nClient Name: Mark Safi",
    );
    expect(doc.quoteRef).toBeNull();
    expect(doc.quoteDate).toBe("Thursday, April 16, 2026");
    expect(doc.clientName).toBe("Mark Safi");
  });

  it("still reads a reference when the document prints one", () => {
    const doc = parseQuotationDocument(
      "Quotation  001-NOV-ABP-2025 Tuesday, December 16, 2025",
    );
    expect(doc.quoteRef).toBe("001-NOV-ABP-2025");
    expect(doc.quoteDate).toBe("Tuesday, December 16, 2025");
  });
});
