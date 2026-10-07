import { createPortal } from "react-dom";
import { money, type QuotationExport } from "../lib/quotation-export.ts";

/**
 * The quotation as it prints: what "Print / PDF" sends to the printer.
 *
 * It used to print the screen, and the screen printed as a blank page: the
 * cargo report's print rule hid everything that was not the report, whether
 * or not a report was open. And had it printed, it would have printed a
 * workspace -- buttons, a sidebar, the Items grid -- rather than a document.
 *
 * So the PDF is its own sheet, laid out as ABP's workbook lays out the Excel
 * file -- ACROW's mark, the header block, the lines, the totals, the terms --
 * and written from the same description of the document as the Excel and the
 * Word files, so the three cannot disagree. It exists only while printing.
 */

export interface PrintExtra {
  readonly contactPerson?: string | undefined;
  readonly salesEngineer?: string | undefined;
  readonly mobile?: string | undefined;
  readonly customerRef?: string | undefined;
  readonly paymentShort?: string | undefined;
  readonly offerValidity?: string | undefined;
  readonly delivery?: string | undefined;
  readonly deliveryPoint?: string | undefined;
  readonly notes?: string | undefined;
}

/** The workbook's footer, as it is printed on every ABP document. */
const COMPANY = {
  name: "ACROW BUILDING PRODUCTS",
  address: "Wady Houf Industrial Zone – Helwan",
  phone: "Tel: (+202) 23254529",
  fax: "Fax: (+202) 23671347",
  email: "E-mail: a.b.p@acrow.co",
};

/** "2026-09-28" as the Excel file prints it: "Monday, September 28, 2026". */
function longDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(date);
}

export function QuotationPrintSheet({
  document: quotation,
  extra = {},
  onReady,
}: {
  document: QuotationExport;
  extra?: PrintExtra | undefined;
  /** Called once the logo has loaded, so the print never catches it half-drawn. */
  onReady: () => void;
}) {
  const field = (label: string) =>
    quotation.fields.find((one) => one.label === label)?.value ?? "";
  const payment = (quotation.terms[0] ?? "").replace(/^Payment Terms:\s*/i, "");
  const paymentShort =
    extra.paymentShort !== undefined && extra.paymentShort !== ""
      ? extra.paymentShort
      : payment;
  const notes = [
    paymentShort === payment ? "" : payment,
    ...quotation.terms.slice(1),
    extra.notes ?? "",
    quotation.amountInWords,
  ].filter((line) => line.trim() !== "");

  const left: [string, string][] = [
    ["Customer", field("Customer")],
    ["Project", field("Project")],
    ["Contact Person", extra.contactPerson ?? ""],
    ["Subject", field("Subject")],
    ["Customer Ref.", extra.customerRef ?? ""],
  ];
  const right: [string, string][] = [
    [
      /proforma/i.test(quotation.title) ? "PI No." : "Quotation No.",
      quotation.reference,
    ],
    ["Date", longDate(quotation.issuedOn)],
    ["Currency", quotation.currency],
    ["Sales Engineer", extra.salesEngineer ?? ""],
    ["Mobile", extra.mobile ?? ""],
  ];

  return createPortal(
    <div className="quotation-print print-root">
      <header className="qprint-head">
        <img
          src="/acrow-logo.png"
          alt="ACROW Building Products"
          onLoad={onReady}
          onError={onReady}
        />
        <h1>{quotation.title.toUpperCase()}</h1>
      </header>

      <table className="qprint-grid">
        <tbody>
          {left.map(([label, value], row) => (
            <tr key={label}>
              <th>{label}</th>
              <td dir="auto">{value}</td>
              <th>{right[row]?.[0]}</th>
              <td dir="auto">{right[row]?.[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="qprint-band">PRICING / DESCRIPTION OF GOODS</h2>
      <table className="qprint-lines">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="numeric">Qty</th>
            <th>Unit</th>
            <th className="numeric">Unit Price</th>
            <th className="numeric">Total</th>
          </tr>
        </thead>
        <tbody>
          {quotation.lines.map((line, index) => (
            <tr key={index}>
              <td>{index + 1}</td>
              <td>{line.description}</td>
              <td className="numeric">{line.qty.toLocaleString("en-US")}</td>
              <td>{line.unit}</td>
              <td className="numeric">{money(line.unitPrice)}</td>
              <td className="numeric">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="qprint-totals">
        <tbody>
          <tr>
            <th>Subtotal</th>
            <td />
            <td className="numeric">{money(quotation.subtotal)}</td>
          </tr>
          {quotation.discount !== 0 && (
            <tr>
              <th>Discount</th>
              <td />
              <td className="numeric">
                − {money(Math.abs(quotation.discount))}
              </td>
            </tr>
          )}
          <tr>
            <th>VAT</th>
            <td className="numeric">
              {quotation.vatLabel
                .replace(/^VAT\s*/i, "")
                .replace(/\.00%$/, "%")}
            </td>
            <td className="numeric">{money(quotation.vat)}</td>
          </tr>
          <tr className="qprint-grand">
            <th>GRAND TOTAL</th>
            <td />
            <td className="numeric">{money(quotation.grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="qprint-band">COMMERCIAL TERMS</h2>
      <table className="qprint-grid">
        <tbody>
          <tr>
            <th>Payment</th>
            <td>{paymentShort}</td>
            <th>Offer Validity</th>
            <td>{extra.offerValidity ?? ""}</td>
          </tr>
          <tr>
            <th>Delivery</th>
            <td>{extra.delivery ?? ""}</td>
            <th>Delivery Point</th>
            <td>{extra.deliveryPoint ?? ""}</td>
          </tr>
          {notes.length > 0 && (
            <tr>
              <th>Notes</th>
              <td colSpan={3}>
                {notes.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="qprint-sign">
        <div>
          <h3>PREPARED BY</h3>
          <p>{extra.salesEngineer ?? ""}</p>
        </div>
        <div>
          <h3>CLIENT ACCEPTANCE</h3>
          <p>Name</p>
          <p>Signature</p>
          <p>Company Stamp</p>
        </div>
      </section>

      <footer className="qprint-foot">
        <strong>{COMPANY.name}</strong>
        <span>
          {COMPANY.address} | {COMPANY.phone} | {COMPANY.fax}
        </span>
        <span>{COMPANY.email}</span>
      </footer>
    </div>,
    document.body,
  );
}
