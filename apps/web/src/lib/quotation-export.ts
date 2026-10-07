/**
 * The quotation, as a file the customer can be sent.
 *
 * Three formats, because three are asked for and each is asked for by someone
 * different: a customer wants a PDF, a procurement department wants the lines
 * in Excel so they can put them in their own sheet, and a contracts office
 * wants Word so they can paste the terms into an agreement.
 *
 * All three are built from **one** description of the document, assembled here
 * from the quotation itself. That is the whole point of this module: three
 * writers reading three different sources is how a customer ends up with a PDF
 * and a spreadsheet that disagree about the total.
 *
 * The layout follows the workbook ABP issues from — header block, the lines,
 * then the money in the order subtotal, discount, VAT, grand total, then the
 * terms — because a customer comparing this to the last quotation they had
 * should be looking at the same document.
 */

export interface ExportLine {
  /** Item code, or the status when there is not one yet. */
  readonly code: string;
  readonly description: string;
  readonly qty: number;
  readonly unit: string;
  readonly unitPrice: number;
  readonly lineTotal: number;
}

export interface ExportField {
  readonly label: string;
  readonly value: string;
}

export interface QuotationExport {
  /** What the document calls itself: a quotation or a proforma invoice. */
  readonly title: string;
  readonly reference: string;
  readonly issuedOn: string;
  readonly currency: string;
  /** The header block, in the order the workbook prints it. */
  readonly fields: readonly ExportField[];
  readonly lines: readonly ExportLine[];
  readonly subtotal: number;
  readonly discount: number;
  readonly vatLabel: string;
  readonly vat: number;
  readonly grandTotal: number;
  readonly amountInWords: string;
  /** The payment sentence, verbatim, and anything else printed under it. */
  readonly terms: readonly string[];
  readonly footNote: string;
}

const MONEY = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

export function money(value: number): string {
  return value.toLocaleString("en-US", MONEY);
}

/** A file name a person can find again: the reference, then the format. */
export function exportFileName(
  document: QuotationExport,
  extension: string,
): string {
  const stem =
    document.reference.trim() === "" ? "quotation" : document.reference;
  return `${stem.replace(/[^\w.-]+/g, "-")}.${extension}`;
}

/**
 * The document as rows, which is what both the spreadsheet and the table in
 * the Word file are built from.
 *
 * Returning rows rather than writing two layouts is what keeps the two files
 * the same document. The first cell of a row is its label where it has one.
 */
export function documentRows(document: QuotationExport): {
  cells: (string | number)[];
  kind: "TITLE" | "FIELD" | "HEAD" | "LINE" | "MONEY" | "TEXT";
}[] {
  const rows: {
    cells: (string | number)[];
    kind: "TITLE" | "FIELD" | "HEAD" | "LINE" | "MONEY" | "TEXT";
  }[] = [
    { cells: [document.title], kind: "TITLE" },
    { cells: [document.reference, document.issuedOn], kind: "FIELD" },
  ];
  for (const field of document.fields)
    rows.push({ cells: [field.label, field.value], kind: "FIELD" });

  rows.push({
    cells: ["Item code", "Description", "Qty", "Unit", "Unit price", "Total"],
    kind: "HEAD",
  });
  for (const line of document.lines)
    rows.push({
      cells: [
        line.code,
        line.description,
        line.qty,
        line.unit,
        line.unitPrice,
        line.lineTotal,
      ],
      kind: "LINE",
    });

  // Rounded to the minor unit on the way out. These figures land in a
  // customer's own spreadsheet, and 350.00000000000006 is our float noise,
  // not a number anybody agreed to.
  const minor = (value: number) => Math.round(value * 100) / 100;
  rows.push({ cells: ["Subtotal", minor(document.subtotal)], kind: "MONEY" });
  if (document.discount !== 0)
    rows.push({
      cells: ["Discount", minor(-Math.abs(document.discount))],
      kind: "MONEY",
    });
  rows.push({ cells: [document.vatLabel, minor(document.vat)], kind: "MONEY" });
  rows.push({
    cells: ["Grand total", minor(document.grandTotal)],
    kind: "MONEY",
  });
  rows.push({ cells: [document.amountInWords], kind: "TEXT" });
  for (const term of document.terms) rows.push({ cells: [term], kind: "TEXT" });
  if (document.footNote.trim() !== "")
    rows.push({ cells: [document.footNote], kind: "TEXT" });
  return rows;
}
