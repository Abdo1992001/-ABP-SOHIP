/**
 * Where each figure goes in ABP's own workbook.
 *
 * The document a customer receives is not drawn by this application — it is
 * ABP's own `.xlsx`, with its colours, its merges, its column widths, its
 * print setup and its logo. The export opens that file and writes the data
 * into it. Nothing else about it changes, which is the point: a quotation sent
 * today and one sent last year are the same document with different numbers.
 *
 * So this module is a **map**, not a layout. Every entry is a cell reference
 * read off the template, and the tests below are what keep the map and the
 * file from drifting apart — a renamed or moved cell fails here rather than
 * silently writing a total into a margin.
 *
 * The template is `ABP_Simple_A4_Quotation_Saturated.xlsx` and its own title
 * cell reads "QUOTATION / PROFORMA INVOICE", so one file serves both and the
 * document type decides which name is printed.
 */

import type { QuotationExport } from "./quotation-export.ts";

/** A cell to write, and what to write in it. */
export interface CellWrite {
  readonly cell: string;
  readonly value: string | number | Date | null;
  /** Set only where the template's own format has to be matched. */
  readonly numberFormat?: string;
}

/**
 * The header block: two columns of label/value pairs on rows 7 to 11.
 *
 * The labels are already in the file — these are the value cells beside them.
 */
export const HEADER_CELLS = {
  customer: "C7",
  quotationNo: "I7",
  project: "C8",
  date: "I8",
  contactPerson: "C9",
  currency: "I9",
  subject: "C10",
  salesEngineer: "I10",
  customerRef: "C11",
  mobile: "I11",
} as const;

/** The first line row, and how many the source template has drawn. */
export const LINES_FIRST_ROW = 15;
export const LINES_ROWS = 10;

/** The columns of the line table, as row 14 labels them. */
export const LINE_COLUMNS = {
  number: "A",
  description: "B",
  qty: "H",
  unit: "I",
  unitPrice: "J",
  discountPct: "K",
  total: "L",
} as const;

export const TOTALS_CELLS = {
  subtotal: "L26",
  vatRate: "K27",
  vat: "L27",
  grandTotal: "L28",
} as const;

export const TERMS_CELLS = {
  payment: "C32",
  offerValidity: "I32",
  delivery: "C33",
  deliveryPoint: "I33",
  notes: "C34",
} as const;

/** The title cell, which names the document. */
export const TITLE_CELL = "I1";

/**
 * The source file draws ten rows. The Excel export expands it when a
 * quotation has more lines and hides unused source rows when it has fewer.
 */
export interface TemplateFill {
  readonly writes: readonly CellWrite[];
  /** Defensive signal; a dynamically sized export leaves this at zero. */
  readonly overflow: number;
}

export interface QuotationTemplateLayout {
  readonly capacity: number;
  readonly insertedRows: number;
  readonly totals: typeof TOTALS_CELLS;
  readonly terms: typeof TERMS_CELLS;
  readonly printLastRow: number;
}

/** The discount column only exists when at least one line has a real discount. */
export function hasSpecialLineDiscount(document: QuotationExport): boolean {
  return document.lines.some((line) => {
    const gross = line.qty * line.unitPrice;
    return gross > 0 && gross - line.lineTotal > 0.005;
  });
}

function shiftedCell(cell: string, rows: number): string {
  const match = /^([A-Z]+)(\d+)$/.exec(cell);
  if (!match) return cell;
  const [, column = "", row = "0"] = match;
  return `${column}${String(Number(row) + rows)}`;
}

export function quotationTemplateLayout(
  lineCount: number,
): QuotationTemplateLayout {
  const visibleRows = Math.max(1, Math.trunc(lineCount));
  const insertedRows = Math.max(0, visibleRows - LINES_ROWS);
  const shifted = <T extends Record<string, string>>(cells: T): T =>
    Object.fromEntries(
      Object.entries(cells).map(([key, cell]) => [
        key,
        shiftedCell(cell, insertedRows),
      ]),
    ) as T;
  return {
    capacity: LINES_ROWS + insertedRows,
    insertedRows,
    totals: shifted(TOTALS_CELLS),
    terms: shifted(TERMS_CELLS),
    printLastRow: 45 + insertedRows,
  };
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The date cell wants a date, not a string that looks like one.
 *
 * The customer-facing format is `Thursday, September 24, 2026`. A string
 * written there is stored as text, so Excel cannot apply that format or keep
 * the value usable as a real date.
 */
function asDate(value: string): Date | string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed;
}

/**
 * Every cell the export writes, for one quotation.
 *
 * Empty strings are written rather than skipped: a template re-used for a
 * second quotation must not keep the first one's customer in a field this one
 * leaves blank.
 */
export function fillQuotationTemplate(
  document: QuotationExport,
  extra: {
    contactPerson?: string;
    salesEngineer?: string;
    mobile?: string;
    customerRef?: string;
    /** A short form of the terms for the Payment cell, which is one row tall. */
    paymentShort?: string;
    offerValidity?: string;
    delivery?: string;
    deliveryPoint?: string;
    notes?: string;
  } = {},
  layout: QuotationTemplateLayout = quotationTemplateLayout(
    document.lines.length,
  ),
): TemplateFill {
  const field = (label: string) =>
    document.fields.find((one) => one.label === label)?.value ?? "";

  const writes: CellWrite[] = [
    { cell: TITLE_CELL, value: document.title.toUpperCase() },
    { cell: HEADER_CELLS.customer, value: field("Customer") },
    { cell: HEADER_CELLS.quotationNo, value: document.reference },
    { cell: HEADER_CELLS.project, value: field("Project") },
    {
      cell: HEADER_CELLS.date,
      value: asDate(document.issuedOn),
      numberFormat: "dddd, mmmm d, yyyy",
    },
    { cell: HEADER_CELLS.contactPerson, value: extra.contactPerson || null },
    { cell: HEADER_CELLS.currency, value: document.currency },
    { cell: HEADER_CELLS.subject, value: field("Subject") },
    { cell: HEADER_CELLS.salesEngineer, value: extra.salesEngineer ?? "" },
    { cell: HEADER_CELLS.customerRef, value: extra.customerRef || null },
    { cell: HEADER_CELLS.mobile, value: extra.mobile || null },
  ];

  const shown = document.lines.slice(0, layout.capacity);
  shown.forEach((line, index) => {
    const row = LINES_FIRST_ROW + index;
    writes.push(
      { cell: `${LINE_COLUMNS.number}${String(row)}`, value: index + 1 },
      {
        cell: `${LINE_COLUMNS.description}${String(row)}`,
        value: line.description,
      },
      { cell: `${LINE_COLUMNS.qty}${String(row)}`, value: line.qty },
      { cell: `${LINE_COLUMNS.unit}${String(row)}`, value: line.unit },
      {
        cell: `${LINE_COLUMNS.unitPrice}${String(row)}`,
        value: money(line.unitPrice),
        numberFormat: "#,##0.00",
      },
      {
        cell: `${LINE_COLUMNS.discountPct}${String(row)}`,
        value:
          line.qty * line.unitPrice - line.lineTotal > 0.005
            ? Math.max(0, 1 - line.lineTotal / (line.qty * line.unitPrice))
            : null,
        numberFormat: "0.00%",
      },
      {
        cell: `${LINE_COLUMNS.total}${String(row)}`,
        value: money(line.lineTotal),
        numberFormat: "#,##0.00",
      },
    );
  });

  // Rows the template drew but this quotation does not use are cleared, or a
  // re-used template shows the last quotation's boards under this one's.
  for (let index = shown.length; index < layout.capacity; index += 1) {
    const row = LINES_FIRST_ROW + index;
    for (const column of Object.values(LINE_COLUMNS))
      writes.push({ cell: `${column}${String(row)}`, value: null });
  }

  const vatRate =
    document.subtotal - document.discount > 0
      ? document.vat / (document.subtotal - document.discount)
      : 0;
  writes.push(
    {
      cell: layout.totals.subtotal,
      value: money(document.subtotal - document.discount),
      numberFormat: "#,##0.00",
    },
    {
      cell: layout.totals.vatRate,
      value: Math.round(vatRate * 10000) / 10000,
      numberFormat: "0%",
    },
    {
      cell: layout.totals.vat,
      value: money(document.vat),
      numberFormat: "#,##0.00",
    },
    {
      cell: layout.totals.grandTotal,
      value: money(document.grandTotal),
      numberFormat: "#,##0.00",
    },
  );

  // The Payment cell is one row of a narrow merge; the staged sentence with
  // its four figures does not fit and was being cut mid-word. The short form
  // goes there, as the template's own sample does — "100% in advance." — and
  // the sentence with the instalments goes in Notes, which is twice as tall
  // and runs the full width.
  const paymentSentence = (document.terms[0] ?? "").replace(
    /^Payment Terms:\s*/i,
    "",
  );
  const paymentShort =
    extra.paymentShort !== undefined && extra.paymentShort !== ""
      ? extra.paymentShort
      : paymentSentence;
  writes.push(
    { cell: layout.terms.payment, value: paymentShort },
    { cell: layout.terms.offerValidity, value: extra.offerValidity ?? "" },
    { cell: layout.terms.delivery, value: extra.delivery ?? "" },
    { cell: layout.terms.deliveryPoint, value: extra.deliveryPoint ?? "" },
    {
      cell: layout.terms.notes,
      value:
        extra.notes ??
        // The instalments, then the amount in words — the two things the
        // issued documents put under the terms.
        [
          paymentShort === paymentSentence ? "" : paymentSentence,
          document.amountInWords,
        ]
          .filter((part) => part !== "")
          // A line each. The cell wraps, so a mid-text separator ends up
          // dangling at the end of a line with nothing after it.
          .join("\n"),
    },
  );

  return {
    writes,
    overflow: Math.max(0, document.lines.length - layout.capacity),
  };
}
