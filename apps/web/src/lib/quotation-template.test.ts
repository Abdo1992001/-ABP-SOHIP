import { describe, expect, it } from "vitest";
import {
  HEADER_CELLS,
  LINES_FIRST_ROW,
  TERMS_CELLS,
  TOTALS_CELLS,
  fillQuotationTemplate,
  hasSpecialLineDiscount,
  quotationTemplateLayout,
} from "./quotation-template.ts";
import type { QuotationExport } from "./quotation-export.ts";

/**
 * The cells below were read off `ABP_Simple_A4_Quotation_Saturated.xlsx`. A
 * change that breaks one of these is a change that writes a figure into the
 * wrong box of a document a customer receives, which is a defect nobody sees
 * until the customer does.
 */
const document: QuotationExport = {
  title: "Quotation",
  reference: "31-Sep-ABP-2026",
  issuedOn: "27-Sep-2026",
  currency: "EGP",
  fields: [
    { label: "Customer", value: "Concord for Engineering and Contracting" },
    { label: "Project", value: "Sheikh Zayed Towers" },
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
    {
      code: "",
      description: "Acrow Curved Board 18 mm x 1000 mm x 2000 mm",
      qty: 64,
      unit: "PCS",
      unitPrice: 3888,
      lineTotal: 248832,
    },
  ],
  subtotal: 512832,
  discount: 0,
  vatLabel: "VAT 14.00%",
  vat: 71796.48,
  grandTotal: 584628.48,
  amountInWords: "Egyptian Pounds Five Hundred Eighty-Four Thousand…",
  terms: ["Payment Terms: 100% in advance."],
  footNote: "",
};

const at = (fill: ReturnType<typeof fillQuotationTemplate>, cell: string) =>
  fill.writes.find((write) => write.cell === cell)?.value;

/** The fixture's first line, which several tests build variants of. */
const firstLine = (): QuotationExport["lines"][number] => {
  const line = document.lines[0];
  if (line === undefined) throw new Error("fixture has no lines");
  return line;
};

describe("the header block", () => {
  const fill = fillQuotationTemplate(document);

  it("puts the customer where the template's Customer label points", () => {
    expect(at(fill, HEADER_CELLS.customer)).toBe(
      "Concord for Engineering and Contracting",
    );
  });

  it("puts the reference in the Quotation No. cell", () => {
    expect(at(fill, HEADER_CELLS.quotationNo)).toBe("31-Sep-ABP-2026");
  });

  it("names the document in its own title cell", () => {
    expect(at(fill, "I1")).toBe("QUOTATION");
  });

  it("names a proforma a proforma, from the same template", () => {
    const proforma = fillQuotationTemplate({
      ...document,
      title: "Proforma Invoice",
    });
    expect(at(proforma, "I1")).toBe("PROFORMA INVOICE");
  });

  it("writes a blank rather than leaving the last quotation's value", () => {
    // A template filled twice must not keep the first customer's contact in a
    // field the second one leaves empty.
    expect(at(fill, HEADER_CELLS.contactPerson)).toBeNull();
    expect(at(fill, HEADER_CELLS.mobile)).toBeNull();
    expect(at(fill, HEADER_CELLS.customerRef)).toBeNull();
  });

  it("carries the fields the screen passes in", () => {
    const withExtras = fillQuotationTemplate(document, {
      contactPerson: "Eng / Ahmed Fekry",
      salesEngineer: "Eng . Nabil Emad",
      mobile: "+20 1029869858",
    });
    expect(at(withExtras, HEADER_CELLS.contactPerson)).toBe(
      "Eng / Ahmed Fekry",
    );
    expect(at(withExtras, HEADER_CELLS.salesEngineer)).toBe("Eng . Nabil Emad");
  });
});

describe("the line table", () => {
  const fill = fillQuotationTemplate(document);

  it("starts on the row the template drew first", () => {
    expect(at(fill, `A${String(LINES_FIRST_ROW)}`)).toBe(1);
    expect(at(fill, `H${String(LINES_FIRST_ROW)}`)).toBe(88);
  });

  it("numbers the lines from one, as the template's # column does", () => {
    expect(at(fill, `A${String(LINES_FIRST_ROW + 1)}`)).toBe(2);
  });

  it("keeps the internal item code off the customer document", () => {
    expect(at(fill, `B${String(LINES_FIRST_ROW)}`)).toBe(
      "Acrow Board 18 mm x 1220 mm x 2440 mm ( M Board )",
    );
  });

  it("leaves a line with no code as just its description", () => {
    expect(at(fill, `B${String(LINES_FIRST_ROW + 1)}`)).toBe(
      "Acrow Curved Board 18 mm x 1000 mm x 2000 mm",
    );
  });

  it("clears the rows this quotation does not use", () => {
    // Otherwise a re-used template shows the previous quotation's boards.
    const thirdRow = LINES_FIRST_ROW + 2;
    expect(at(fill, `B${String(thirdRow)}`)).toBeNull();
    expect(at(fill, `L${String(thirdRow)}`)).toBeNull();
  });

  it("rounds money to the minor unit before it is written", () => {
    const noisy = fillQuotationTemplate({
      ...document,
      lines: [{ ...firstLine(), lineTotal: 264000.00000000006 }],
    });
    expect(at(noisy, `L${String(LINES_FIRST_ROW)}`)).toBe(264000);
  });

  it("leaves the special-discount cell empty when there is no discount", () => {
    expect(at(fill, `K${String(LINES_FIRST_ROW)}`)).toBeNull();
    expect(hasSpecialLineDiscount(document)).toBe(false);
  });

  it("writes and detects a real line discount", () => {
    const discountedDocument = {
      ...document,
      lines: [{ ...firstLine(), lineTotal: 237600 }],
    };
    const discounted = fillQuotationTemplate(discountedDocument);
    expect(at(discounted, `K${String(LINES_FIRST_ROW)}`)).toBeCloseTo(0.1);
    expect(hasSpecialLineDiscount(discountedDocument)).toBe(true);
  });

  it("expands the table instead of dropping lines after the tenth", () => {
    const layout = quotationTemplateLayout(11);
    const many = fillQuotationTemplate(
      {
        ...document,
        lines: Array.from({ length: 11 }, firstLine),
      },
      {},
      layout,
    );
    expect(many.overflow).toBe(0);
    expect(at(many, `A${String(LINES_FIRST_ROW + 10)}`)).toBe(11);
    expect(layout.insertedRows).toBe(1);
    expect(layout.totals.grandTotal).toBe("L29");
    expect(layout.terms.payment).toBe("C33");
  });

  it("reports no overflow when everything fits", () => {
    expect(fill.overflow).toBe(0);
  });
});

describe("the dynamic workbook layout", () => {
  it("keeps the original totals and terms positions for one line", () => {
    const layout = quotationTemplateLayout(1);
    expect(layout.insertedRows).toBe(0);
    expect(layout.totals).toEqual(TOTALS_CELLS);
    expect(layout.terms).toEqual(TERMS_CELLS);
    expect(layout.printLastRow).toBe(45);
  });

  it("moves every dependent section when extra line rows are inserted", () => {
    const layout = quotationTemplateLayout(12);
    expect(layout.insertedRows).toBe(2);
    expect(layout.capacity).toBe(12);
    expect(layout.totals.subtotal).toBe("L28");
    expect(layout.totals.grandTotal).toBe("L30");
    expect(layout.terms.payment).toBe("C34");
    expect(layout.terms.notes).toBe("C36");
    expect(layout.printLastRow).toBe(47);
  });
});

describe("the totals", () => {
  const fill = fillQuotationTemplate(document);

  it("writes the taxable amount as the subtotal the template shows", () => {
    expect(at(fill, TOTALS_CELLS.subtotal)).toBe(512832);
  });

  it("writes the VAT rate as a fraction, because the cell is a percentage", () => {
    // The template formats the VAT cell as 0%, so 0.14 prints as 14%.
    expect(at(fill, TOTALS_CELLS.vatRate)).toBeCloseTo(0.14, 4);
  });

  it("takes the discount off the subtotal, as the template has no discount row", () => {
    const discounted = fillQuotationTemplate({
      ...document,
      discount: 12832,
    });
    expect(at(discounted, TOTALS_CELLS.subtotal)).toBe(500000);
  });

  it("writes the grand total the document states", () => {
    expect(at(fill, TOTALS_CELLS.grandTotal)).toBe(584628.48);
  });
});

describe("the commercial terms", () => {
  const fill = fillQuotationTemplate(document);

  it("drops the prefix, because the template prints its own Payment label", () => {
    expect(at(fill, TERMS_CELLS.payment)).toBe("100% in advance.");
  });

  it("falls back to the amount in words in the notes box", () => {
    expect(at(fill, TERMS_CELLS.notes)).toContain("Egyptian Pounds");
  });

  it("prefers a note the screen supplies", () => {
    const noted = fillQuotationTemplate(document, {
      notes: "Ex-works Helwan.",
    });
    expect(at(noted, TERMS_CELLS.notes)).toBe("Ex-works Helwan.");
  });
});

describe("the date cell", () => {
  it("writes a date, not a string that looks like one", () => {
    // The template formats it dd-mmm-yyyy; a string is stored as text and the
    // format never applies, so the customer sees an ISO timestamp.
    const fill = fillQuotationTemplate({
      ...document,
      issuedOn: "2026-09-27T00:00:00.000Z",
    });
    expect(at(fill, HEADER_CELLS.date)).toBeInstanceOf(Date);
    expect(
      fill.writes.find((write) => write.cell === HEADER_CELLS.date)
        ?.numberFormat,
    ).toBe("dddd, mmmm d, yyyy");
  });

  it("leaves a date it cannot read alone rather than inventing one", () => {
    const fill = fillQuotationTemplate({ ...document, issuedOn: "soon" });
    expect(at(fill, HEADER_CELLS.date)).toBe("soon");
  });

  it("writes a blank when there is no date", () => {
    const fill = fillQuotationTemplate({ ...document, issuedOn: "" });
    expect(at(fill, HEADER_CELLS.date)).toBe("");
  });
});
