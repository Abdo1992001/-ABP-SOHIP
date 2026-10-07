import { describe, expect, it } from "vitest";
import {
  PROFORMA_HEADER,
  PROFORMA_LINES_FIRST_ROW,
  PROFORMA_LINES_ROWS,
  PROFORMA_PAYMENT_ROWS,
  PROFORMA_TOTALS,
  fillProformaTemplate,
} from "./proforma-template.ts";
import type { QuotationExport } from "./quotation-export.ts";

/**
 * The figures below are `A207-2026`, the proforma this template came from:
 * 197,809.64 ex-works, 9,712 freight to Gdansk, 207,521.64 CIF, net 109,254.07
 * and gross 120,179.48 kg. A change that breaks these is a change that would
 * have issued a different invoice for a shipment ABP has actually sent.
 */
const document: QuotationExport = {
  title: "Proforma Invoice",
  reference: "A207-2026",
  issuedOn: "2026-05-31",
  currency: "USD",
  fields: [{ label: "Customer", value: "BAUKRANE Limited Liability Company" }],
  lines: [
    {
      code: "WARC001265",
      description:
        "ACROW Board 14.5mm x 232 mm x 1482 mm (M- Board) ( With Tie-Rod Holes) Bauframe",
      qty: 50,
      unit: "PCS",
      unitPrice: 7.542982824,
      lineTotal: 377.1491412,
    },
  ],
  subtotal: 197_809.64,
  discount: 0,
  vatLabel: "VAT 0%",
  vat: 0,
  grandTotal: 197_809.64,
  amountInWords:
    "US Dollars One Hundred Ninety-Seven Thousand Eight Hundred Nine and Sixty-Four Cents Only",
  terms: [],
  footNote: "",
};

const at = (fill: ReturnType<typeof fillProformaTemplate>, cell: string) =>
  fill.writes.find((write) => write.cell === cell)?.value;

describe("the proforma's two parties", () => {
  const fill = fillProformaTemplate(document, {
    buyerAddress: "36 Jana Keplera st., 80-299 Gdansk",
    buyerTaxNo: "584-26-59-127",
    customerPo: "ZZ/26/06/0020",
  });

  it("names the buyer, because a customs document has to", () => {
    expect(at(fill, PROFORMA_HEADER.buyerName)).toBe(
      "BAUKRANE Limited Liability Company",
    );
    expect(at(fill, PROFORMA_HEADER.buyerAddress)).toBe(
      "36 Jana Keplera st., 80-299 Gdansk",
    );
  });

  it("carries the buyer's tax number and their own PO", () => {
    expect(at(fill, PROFORMA_HEADER.buyerTaxNo)).toBe("584-26-59-127");
    expect(at(fill, PROFORMA_HEADER.customerPo)).toBe("ZZ/26/06/0020");
  });

  it("heads the part-number column with the customer's own name", () => {
    expect(at(fill, PROFORMA_HEADER.customerItemHeader)).toBe(
      "BAUKRANE Limited Liability Company Item Nr.",
    );
  });

  it("falls back to a neutral heading with no customer", () => {
    const blank = fillProformaTemplate({ ...document, fields: [] });
    expect(at(blank, PROFORMA_HEADER.customerItemHeader)).toBe(
      "Customer Item Nr.",
    );
  });

  it("titles the document with its own reference", () => {
    expect(at(fill, PROFORMA_HEADER.title)).toBe(
      "Proforma Invoice ( A207-2026 )",
    );
  });

  it("writes the date as a date, so the cell's format applies", () => {
    expect(at(fill, PROFORMA_HEADER.date)).toBeInstanceOf(Date);
  });
});

describe("the lines a proforma carries", () => {
  const fill = fillProformaTemplate(document, { lineWeightsKg: [4.24] });

  it("starts on row 25, where the template's table starts", () => {
    expect(at(fill, `B${String(PROFORMA_LINES_FIRST_ROW)}`)).toBe(1);
  });

  it("puts the customer's part number in its own column", () => {
    expect(at(fill, `C${String(PROFORMA_LINES_FIRST_ROW)}`)).toBe("WARC001265");
  });

  it("carries the weight of one piece, which a quotation never does", () => {
    expect(at(fill, `G${String(PROFORMA_LINES_FIRST_ROW)}`)).toBe(4.24);
  });

  it("leaves the weight blank rather than guessing at it", () => {
    const noWeights = fillProformaTemplate(document);
    expect(at(noWeights, `G${String(PROFORMA_LINES_FIRST_ROW)}`)).toBeNull();
  });

  it("holds sixty-eight lines, because a proforma routinely runs that long", () => {
    // A207-2026 itself had sixty-four.
    const many = fillProformaTemplate({
      ...document,
      lines: Array.from({ length: 64 }, () => {
        const line = document.lines[0];
        if (line === undefined) throw new Error("fixture has no lines");
        return line;
      }),
    });
    expect(many.overflow).toBe(0);
    expect(PROFORMA_LINES_ROWS).toBe(68);
  });

  it("clears the rows this shipment does not use", () => {
    expect(at(fill, `D${String(PROFORMA_LINES_FIRST_ROW + 1)}`)).toBeNull();
  });
});

describe("what the shipment is weighed and cleared on", () => {
  const fill = fillProformaTemplate(document, {
    netWeightKg: 109_254.07177325,
    grossWeightKg: 120_179.478950575,
    leadTime: "36-43 Days",
    finalDestination: "Gdansk Port-Poland",
  });

  it("states the net and the gross separately", () => {
    expect(at(fill, PROFORMA_TOTALS.netWeight)).toBeCloseTo(109_254.07, 2);
    expect(at(fill, PROFORMA_TOTALS.grossWeight)).toBeCloseTo(120_179.48, 2);
  });

  it("carries the lead time and the destination", () => {
    expect(at(fill, PROFORMA_TOTALS.leadTime)).toBe("36-43 Days");
    expect(at(fill, PROFORMA_TOTALS.finalDestination)).toBe(
      "Gdansk Port-Poland",
    );
  });

  it("writes the ex-works total in both places the template prints it", () => {
    expect(at(fill, PROFORMA_TOTALS.exWorks)).toBe(197_809.64);
    expect(at(fill, PROFORMA_TOTALS.exWorksAgain)).toBe(197_809.64);
  });
});

describe("freight, and the two totals it creates", () => {
  it("adds freight to ex-works to give CIF", () => {
    const fill = fillProformaTemplate(document, {
      freightCost: 9712,
      finalDestination: "Gdansk Port",
      cifInWords: "US Dollars Two Hundred Seven Thousand…",
    });
    expect(at(fill, PROFORMA_TOTALS.freight)).toBe(9712);
    expect(at(fill, PROFORMA_TOTALS.cif)).toBe(207_521.64);
    expect(at(fill, PROFORMA_TOTALS.cifLabel)).toBe(
      "TOTAL PRICE CIF Gdansk Port",
    );
  });

  it("leaves the whole freight block out of an ex-works proforma", () => {
    // Printing an empty CIF line answers a question nobody asked.
    const fill = fillProformaTemplate(document);
    for (const cell of [
      PROFORMA_TOTALS.freight,
      PROFORMA_TOTALS.cif,
      PROFORMA_TOTALS.cifLabel,
      PROFORMA_TOTALS.cifInWords,
    ])
      expect(at(fill, cell)).toBeNull();
  });
});

describe("the payment conditions", () => {
  it("writes one instalment to a row", () => {
    const fill = fillProformaTemplate(document, {
      paymentConditions: [
        "30% Advance Payment",
        "30% against shipping documents",
      ],
    });
    expect(at(fill, PROFORMA_PAYMENT_ROWS[0])).toBe("30% Advance Payment");
    expect(at(fill, PROFORMA_PAYMENT_ROWS[1])).toBe(
      "30% against shipping documents",
    );
  });

  it("clears the rows the term does not use", () => {
    const fill = fillProformaTemplate(document, {
      paymentConditions: ["100% in advance"],
    });
    expect(at(fill, PROFORMA_PAYMENT_ROWS[1])).toBeNull();
    expect(at(fill, PROFORMA_PAYMENT_ROWS[3])).toBeNull();
  });
});
