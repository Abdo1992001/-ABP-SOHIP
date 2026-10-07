/**
 * Where each figure goes in ABP's proforma invoice.
 *
 * Same idea as `quotation-template.ts`: the document is ABP's own `.xlsx` and
 * the export writes into it. What differs is what a proforma has to carry and
 * a quotation does not, all of which are on the issued documents in the
 * archive and none of which are invented here:
 *
 *   - a **supplier and a buyer block**, because a proforma is a customs
 *     document and both parties have to be on it by name, address and tax
 *     number;
 *   - the **weight of every line**, and a net and a gross total, because the
 *     shipment is weighed;
 *   - **freight as its own line**, so EX-WORK and CIF are both stated —
 *     `A207-2026` reads 197,809.64 ex-works and 207,521.64 CIF Gdansk;
 *   - **country of origin and customs tariff**, which clear the goods;
 *   - the **bank details** payment is made against.
 *
 * The line table runs from row 25 to row 92 — sixty-eight rows, against the
 * quotation template's eight, because a proforma routinely runs to sixty-four
 * lines and `A207-2026` did.
 */

import type { CellWrite } from "./quotation-template.ts";
import type { QuotationExport } from "./quotation-export.ts";

export const PROFORMA_HEADER = {
  title: "B8",
  date: "C9",
  buyerName: "I11",
  buyerAddress: "J13",
  customerPo: "J14",
  buyerTel: "J15",
  buyerTaxNo: "J16",
  buyerEmail: "J17",
  contactPerson: "C19",
  contactMobile: "C20",
  contactEmail: "C21",
  goodsTitle: "B23",
  customerItemHeader: "C24",
} as const;

export const PROFORMA_LINES_FIRST_ROW = 25;
export const PROFORMA_LINES_ROWS = 68;

export const PROFORMA_LINE_COLUMNS = {
  number: "B",
  customerItem: "C",
  item: "D",
  unitWeight: "G",
  qty: "I",
  unitPrice: "J",
  discount: "K",
  unitPriceAfterDiscount: "L",
  total: "M",
} as const;

export const PROFORMA_TOTALS = {
  totalWeight: "G93",
  exWorks: "M94",
  amountInWords: "B96",
  netWeight: "C101",
  grossWeight: "C102",
  leadTime: "C103",
  finalDestination: "C104",
  exWorksAgain: "N100",
  freightLabel: "I101",
  freight: "N101",
  cifLabel: "I102",
  cif: "N102",
  cifInWords: "I103",
} as const;

export const PROFORMA_PAYMENT_ROWS = ["I110", "I111", "I112", "I113"] as const;

export interface ProformaExtra {
  readonly buyerName?: string;
  readonly buyerAddress?: string;
  readonly buyerTel?: string;
  readonly buyerTaxNo?: string;
  readonly buyerEmail?: string;
  readonly customerPo?: string;
  readonly contactPerson?: string;
  readonly contactMobile?: string;
  readonly contactEmail?: string;
  /** Net weight of the goods, in kilograms. */
  readonly netWeightKg?: number;
  /** Net plus packing, which is what the shipment is booked at. */
  readonly grossWeightKg?: number;
  readonly leadTime?: string;
  readonly finalDestination?: string;
  /** Freight, and the words under the CIF total that name it. */
  readonly freightCost?: number;
  readonly freightLabel?: string;
  /** The weight of one piece on each line, by line index. */
  readonly lineWeightsKg?: readonly number[];
  /** The customer's own part numbers, by line index. */
  readonly customerItems?: readonly string[];
  /** Each instalment of the payment term, one to a row. */
  readonly paymentConditions?: readonly string[];
  /** The amount in words for the CIF total, when there is freight. */
  readonly cifInWords?: string;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function asDate(value: string): Date | string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed;
}

export interface ProformaFill {
  readonly writes: readonly CellWrite[];
  readonly overflow: number;
}

export function fillProformaTemplate(
  document: QuotationExport,
  extra: ProformaExtra = {},
): ProformaFill {
  const field = (label: string) =>
    document.fields.find((one) => one.label === label)?.value ?? "";
  const customer = extra.buyerName ?? field("Customer");
  const title = `Proforma Invoice ( ${document.reference} )`;

  const writes: CellWrite[] = [
    { cell: PROFORMA_HEADER.title, value: title },
    { cell: PROFORMA_HEADER.goodsTitle, value: title },
    { cell: PROFORMA_HEADER.date, value: asDate(document.issuedOn) },
    { cell: PROFORMA_HEADER.buyerName, value: customer },
    { cell: PROFORMA_HEADER.buyerAddress, value: extra.buyerAddress ?? "" },
    { cell: PROFORMA_HEADER.customerPo, value: extra.customerPo ?? "" },
    { cell: PROFORMA_HEADER.buyerTel, value: extra.buyerTel ?? "" },
    { cell: PROFORMA_HEADER.buyerTaxNo, value: extra.buyerTaxNo ?? "" },
    { cell: PROFORMA_HEADER.buyerEmail, value: extra.buyerEmail ?? "" },
    {
      cell: PROFORMA_HEADER.contactPerson,
      value:
        extra.contactPerson === undefined ? "" : `: ${extra.contactPerson}`,
    },
    {
      cell: PROFORMA_HEADER.contactMobile,
      value:
        extra.contactMobile === undefined ? "" : `: ${extra.contactMobile}`,
    },
    {
      cell: PROFORMA_HEADER.contactEmail,
      value: extra.contactEmail === undefined ? "" : `: ${extra.contactEmail}`,
    },
    // The part-number column is headed with the customer's name on their copy.
    {
      cell: PROFORMA_HEADER.customerItemHeader,
      value: customer === "" ? "Customer Item Nr." : `${customer} Item Nr.`,
    },
  ];

  const shown = document.lines.slice(0, PROFORMA_LINES_ROWS);
  shown.forEach((line, index) => {
    const row = PROFORMA_LINES_FIRST_ROW + index;
    const at = (column: string) => `${column}${String(row)}`;
    const weight = extra.lineWeightsKg?.[index];
    writes.push(
      { cell: at(PROFORMA_LINE_COLUMNS.number), value: index + 1 },
      {
        cell: at(PROFORMA_LINE_COLUMNS.customerItem),
        value: extra.customerItems?.[index] ?? line.code,
      },
      { cell: at(PROFORMA_LINE_COLUMNS.item), value: line.description },
      {
        cell: at(PROFORMA_LINE_COLUMNS.unitWeight),
        value: weight === undefined ? null : Math.round(weight * 100) / 100,
        numberFormat: "0.00",
      },
      { cell: at(PROFORMA_LINE_COLUMNS.qty), value: line.qty },
      {
        cell: at(PROFORMA_LINE_COLUMNS.unitPrice),
        value: money(line.unitPrice),
        numberFormat: "0.000",
      },
      {
        // The template's Discount column is a percentage; a line priced with
        // the discount already taken off shows none.
        cell: at(PROFORMA_LINE_COLUMNS.discount),
        value: null,
      },
      {
        cell: at(PROFORMA_LINE_COLUMNS.unitPriceAfterDiscount),
        value: money(line.unitPrice),
        numberFormat: "0.000",
      },
      {
        cell: at(PROFORMA_LINE_COLUMNS.total),
        value: money(line.lineTotal),
        numberFormat: "#,##0.00",
      },
    );
  });

  // Rows the template draws but this shipment does not fill.
  for (let index = shown.length; index < PROFORMA_LINES_ROWS; index += 1) {
    const row = PROFORMA_LINES_FIRST_ROW + index;
    for (const column of Object.values(PROFORMA_LINE_COLUMNS))
      writes.push({ cell: `${column}${String(row)}`, value: null });
  }

  const exWorks = money(document.subtotal - document.discount);
  const freight = extra.freightCost ?? 0;
  writes.push(
    {
      cell: PROFORMA_TOTALS.totalWeight,
      value:
        extra.grossWeightKg === undefined ? null : money(extra.grossWeightKg),
      numberFormat: "#,##0.00",
    },
    {
      cell: PROFORMA_TOTALS.exWorks,
      value: exWorks,
      numberFormat: "#,##0.00",
    },
    { cell: PROFORMA_TOTALS.amountInWords, value: document.amountInWords },
    {
      cell: PROFORMA_TOTALS.netWeight,
      value: extra.netWeightKg === undefined ? null : money(extra.netWeightKg),
      numberFormat: "#,##0.00",
    },
    {
      cell: PROFORMA_TOTALS.grossWeight,
      value:
        extra.grossWeightKg === undefined ? null : money(extra.grossWeightKg),
      numberFormat: "#,##0.00",
    },
    { cell: PROFORMA_TOTALS.leadTime, value: extra.leadTime ?? "" },
    {
      cell: PROFORMA_TOTALS.finalDestination,
      value: extra.finalDestination ?? "",
    },
    {
      cell: PROFORMA_TOTALS.exWorksAgain,
      value: exWorks,
      numberFormat: "#,##0.00",
    },
  );

  // The freight block only exists when the shipment is sold delivered. An
  // ex-works proforma that printed an empty CIF line would be answering a
  // question nobody asked.
  if (freight > 0) {
    writes.push(
      {
        cell: PROFORMA_TOTALS.freightLabel,
        value: extra.freightLabel ?? "FREIGHT COST (CIF)",
      },
      {
        cell: PROFORMA_TOTALS.freight,
        value: money(freight),
        numberFormat: "#,##0.00",
      },
      {
        cell: PROFORMA_TOTALS.cifLabel,
        value: `TOTAL PRICE CIF${
          extra.finalDestination === undefined
            ? ""
            : ` ${extra.finalDestination}`
        }`,
      },
      {
        cell: PROFORMA_TOTALS.cif,
        value: money(exWorks + freight),
        numberFormat: "#,##0.00",
      },
      { cell: PROFORMA_TOTALS.cifInWords, value: extra.cifInWords ?? "" },
    );
  } else {
    for (const cell of [
      PROFORMA_TOTALS.freightLabel,
      PROFORMA_TOTALS.freight,
      PROFORMA_TOTALS.cifLabel,
      PROFORMA_TOTALS.cif,
      PROFORMA_TOTALS.cifInWords,
    ])
      writes.push({ cell, value: null });
  }

  // One instalment a row, and the rows the term does not use are cleared.
  PROFORMA_PAYMENT_ROWS.forEach((cell, index) => {
    writes.push({ cell, value: extra.paymentConditions?.[index] ?? null });
  });

  return {
    writes,
    overflow: Math.max(0, document.lines.length - PROFORMA_LINES_ROWS),
  };
}
