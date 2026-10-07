/**
 * Reading a past ACROW quotation back out of its own PDF.
 *
 * The company has years of quotations as PDFs and nothing else. Re-typing one
 * to quote a repeat customer is where quantities get transposed, so this turns
 * the text of such a document back into lines the system can hold.
 *
 * Every rule below was measured against the 167 quotations in the sample
 * folder rather than designed from one example, because the folder does not
 * agree with itself. The price table appears with three different column sets:
 *
 *     #    | Item Desc | QTY | UNIT PRICE | TOTAL
 *     Zone | Item Desc | QTY m² | QTY | UNIT PRICE | TOTAL
 *     Zone | Item Desc | QTY | QTY after 10% nesting | UNIT PRICE | TOTAL
 *
 * A parser that takes the quantity by position is wrong on a third of the
 * folder — the first attempt at this was, on 110 of 348 lines. Position cannot
 * tell those layouts apart, but arithmetic can: the last number on the row is
 * the line total, the one before it is the unit price, and the quantity is
 * whichever remaining number satisfies `qty × unit = total`.
 *
 * Where no number satisfies it, the row is **reported, not guessed at**. A
 * quotation imported with an invented quantity is worse than one that asks to
 * be checked, because nothing downstream would ever flag it again.
 *
 * Pure text in, structure out: the PDF-to-text step lives with the caller, so
 * this file is testable against the exact strings the real documents produce.
 */

export interface ParsedQuotationLine {
  /** As printed, with the row number and the numeric columns removed. */
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ParsedQuotationDocument {
  quoteRef: string | null;
  /** The date exactly as printed, e.g. "Wednesday, August 5, 2026". */
  quoteDate: string | null;
  clientName: string | null;
  projectName: string | null;
  attention: string | null;
  salesEngineer: string | null;
  subject: string | null;
  lines: ParsedQuotationLine[];
  /** Sum of the line totals. */
  subtotal: number;
  /**
   * Rows that sat inside the price table, carried numbers, and did not
   * reconcile. They are handed back verbatim so a person can decide.
   */
  unreconciledRows: string[];
  /** Terms printed under the table, as key/value as they appear. */
  terms: { label: string; value: string }[];
  /**
   * The totals the document itself prints, as printed. They are not used to
   * compute anything — they are here so a reader can see at a glance whether
   * the lines that were read add up to the document they came from.
   */
  printedTotals: { label: string; value: number }[];
}

const HEADER_FIELDS: {
  key: "clientName" | "projectName" | "attention" | "salesEngineer" | "subject";
  /** Label and value on one line. */
  pattern: RegExp;
  /** Label alone on its line, its value on the neighbouring one. */
  bare: RegExp;
}[] = [
  {
    key: "clientName",
    pattern: /^Client\s*Name\s*:\s*(.+)$/i,
    bare: /^Client\s*Name\s*:\s*$/i,
  },
  {
    key: "projectName",
    pattern: /^Project\s*Name\s*:\s*(.+)$/i,
    bare: /^Project\s*Name\s*:\s*$/i,
  },
  { key: "attention", pattern: /^Attn\s*:\s*(.+)$/i, bare: /^Attn\s*:\s*$/i },
  {
    key: "salesEngineer",
    pattern: /^Sales\s*Engineer\s*:\s*(.+)$/i,
    bare: /^Sales\s*Engineer\s*:\s*$/i,
  },
  {
    key: "subject",
    pattern: /^Subject\s*:\s*(.+)$/i,
    bare: /^Subject\s*:\s*$/i,
  },
];

const QUOTATION_LINE = /^Quotation\s+(\S+)\s+(.*)$/i;
const TABLE_HEADER = /\bITEM\s+DESC\b/i;
/**
 * The labels under the table. Any of them ends the item rows.
 *
 * The label and its figure sit on one line — `Total 512,832.00` — so this
 * matches a prefix rather than a whole line, and the figure is captured as a
 * cross-check against the lines that were read.
 */
const TOTALS_LABEL =
  /^(Grand\s*Total(?:\s+After\s+Special\s+Discount[^\d]*)?|Sub\s*Total|Total|Vat\s*\([^)]*\)|Special\s*Discount[^\d]*)\s*([\d,]+\.\d{2})?\s*$/i;
/**
 * The rest of the table's own heading. It wraps onto its own lines, and
 * without this it reads as the first item's description.
 */
const TABLE_HEADER_TAIL =
  /^(EXCLUDING\s+VAT|TOTAL\s+PRICE|UNITE?\s+PRICE|QTY\b)/i;
/**
 * A priced row ends with its line total. A line that ends in anything else is
 * not a row that failed to reconcile — it is half of a wrapped description,
 * and treating the two the same reported `Acrow Curved Board ... ( M` as a
 * broken price row while losing it from the description it belonged to.
 */
const ENDS_WITH_FIGURE = /\d\s*$/;
const TERM_LINE =
  /^(Payment|Delivery\s*Time|Place\s*of\s*Delivery|Offer\s*Validation|Validity)\s*[:.]?\s*(.+)$/i;

/** A number as these documents print it: 1,425,614.40 / 336 / 73.40 */
const NUMBER_TOKEN =
  /(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g;

interface Found {
  value: number;
  start: number;
  end: number;
}

function numbersIn(line: string): Found[] {
  const found: Found[] = [];
  NUMBER_TOKEN.lastIndex = 0;
  let match = NUMBER_TOKEN.exec(line);
  while (match !== null) {
    const value = Number(match[1]?.replace(/,/g, "") ?? "");
    if (Number.isFinite(value))
      found.push({ value, start: match.index, end: NUMBER_TOKEN.lastIndex });
    match = NUMBER_TOKEN.exec(line);
  }
  return found;
}

/** Within rounding of what the document printed. */
function reconciles(qty: number, unit: number, total: number): boolean {
  return Math.abs(qty * unit - total) <= Math.max(0.05, total * 0.0005);
}

function cleanDescription(line: string, upTo: number): string {
  return line
    .slice(0, upTo)
    .replace(/^\d{1,3}[\s.)-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The quantity is sometimes printed hard against the text before it, because
 * the column gap is lost in extraction: `WITHOUT TIE ROD HOLES40 87.77 79.00
 * 3,160.00`, or `D=0.7238 4252.50 161,595.00` where `D=0.72` and a quantity of
 * `38` have run together. The split is only accepted when the arithmetic then
 * works, so a wrong split cannot survive as a quantity.
 */
function recoverGluedQuantity(
  line: string,
  unit: number,
  total: number,
): ParsedQuotationLine | null {
  const implied = total / unit;
  if (!Number.isFinite(implied) || implied <= 0) return null;
  const wanted = String(Math.round(implied));
  if (!reconciles(Number(wanted), unit, total)) return null;
  // The quantity column sits at the END of the row's text, so search from the
  // right: the digits "18" also appear in "18 mm" near the start of nearly
  // every ACROW description, and cutting there would take the description
  // with it.
  const at = line.lastIndexOf(wanted);
  if (at < 0) return null;
  return {
    description: cleanDescription(line, at),
    qty: Number(wanted),
    unitPrice: unit,
    lineTotal: total,
  };
}

/**
 * Some of these quotations carry the tax on the row: the last three numbers
 * are the net line total, its VAT, and the total including VAT. Taking the
 * last number as the line total there would double-count the tax against a
 * subtotal the document computes before it.
 *
 * The pair is only dropped when it proves itself — the last number has to be
 * the sum of the two before it, and the middle one has to be a plausible tax
 * rate on the net. Nothing is dropped on the strength of its position.
 */
function endsWithVatPair(found: Found[]): boolean {
  if (found.length < 5) return false;
  const total = found[found.length - 1]?.value ?? 0;
  const vat = found[found.length - 2]?.value ?? 0;
  const net = found[found.length - 3]?.value ?? 0;
  if (net <= 0 || vat <= 0) return false;
  if (Math.abs(net + vat - total) > Math.max(0.05, total * 0.0005))
    return false;
  const rate = vat / net;
  return rate > 0.01 && rate < 0.3;
}

function readColumns(
  line: string,
  found: Found[],
  lastIndex: number,
): ParsedQuotationLine | null {
  const total = found[lastIndex];
  const unit = found[lastIndex - 1];
  if (total === undefined || unit === undefined) return null;
  if (unit.value <= 0 || total.value <= 0) return null;

  for (const candidate of found.slice(0, lastIndex - 1)) {
    if (candidate.value <= 0) continue;
    if (reconciles(candidate.value, unit.value, total.value))
      return {
        description: cleanDescription(line, candidate.start),
        qty: candidate.value,
        unitPrice: unit.value,
        lineTotal: total.value,
      };
  }
  return recoverGluedQuantity(
    line.slice(0, unit.start),
    unit.value,
    total.value,
  );
}

export function parseQuotationLine(line: string): ParsedQuotationLine | null {
  const found = numbersIn(line);
  if (found.length < 3) return null;
  const direct = readColumns(line, found, found.length - 1);
  if (direct !== null) return direct;
  if (endsWithVatPair(found)) return readColumns(line, found, found.length - 3);
  return null;
}

export function parseQuotationDocument(text: string): ParsedQuotationDocument {
  const lines = text.split("\n").map((line) => line.trim());

  const doc: ParsedQuotationDocument = {
    quoteRef: null,
    quoteDate: null,
    clientName: null,
    projectName: null,
    attention: null,
    salesEngineer: null,
    subject: null,
    lines: [],
    subtotal: 0,
    unreconciledRows: [],
    terms: [],
    printedTotals: [],
  };

  // The header block repeats on every page, so the first occurrence wins and
  // the rest are the same words again.
  for (const [index, line] of lines.entries()) {
    if (doc.quoteRef === null && doc.quoteDate === null) {
      const quote = QUOTATION_LINE.exec(line);
      if (quote !== null) {
        const first = quote[1] ?? "";
        const rest = quote[2]?.trim() ?? "";
        // Not every one of these documents carries a reference: some print
        // "Quotation  Thursday, April 16, 2026" and nothing else, and the
        // weekday was being stored as the quotation number. A reference
        // always carries a digit; a weekday never does.
        if (/[0-9]/.test(first) && !/^[A-Za-z]+,$/.test(first)) {
          doc.quoteRef = first;
          doc.quoteDate = rest === "" ? null : rest;
        } else {
          doc.quoteDate = [first, rest].filter((part) => part !== "").join(" ");
        }
      }
    }
    for (const field of HEADER_FIELDS) {
      if (doc[field.key] !== null) continue;
      const match = field.pattern.exec(line);
      if (match !== null) {
        doc[field.key] = match[1]?.trim() ?? null;
        continue;
      }
      // A label alone on its line: these are table cells, and a label
      // vertically centred against a two-line value lands on its own
      // baseline. The value is then the line after it — or, where the cell
      // sits lower than its value, the line before.
      if (!field.bare.test(line)) continue;
      const after = lines[index + 1] ?? "";
      const before = lines[index - 1] ?? "";
      const usable = (candidate: string) =>
        candidate !== "" &&
        !candidate.includes(":") &&
        candidate.length <= 120 &&
        !QUOTATION_LINE.test(candidate);
      if (usable(after)) doc[field.key] = after.trim();
      else if (usable(before)) doc[field.key] = before.trim();
    }
  }

  // A document can carry several price tables — one per system, each with its
  // own totals — so this runs as a state machine rather than finding "the"
  // table once.
  let inTable = false;
  /**
   * A description too long for its cell wraps, and the wrapped half lands on
   * its own baseline — above the priced row or below it, depending on where
   * the cell's text was centred. Text with no figures inside a price table is
   * one of those halves, so it is held and attached to the row it belongs to
   * rather than dropped, which is what left an imported line with no
   * description at all.
   */
  let pendingText: string[] = [];
  const flushPendingOnto = (line: ParsedQuotationLine | undefined) => {
    if (line !== undefined && pendingText.length > 0)
      line.description = [line.description, ...pendingText]
        .filter((part) => part !== "")
        .join(" ");
    pendingText = [];
  };

  for (const line of lines) {
    if (line === "") continue;
    if (TABLE_HEADER.test(line)) {
      inTable = true;
      pendingText = [];
      continue;
    }
    const totals = TOTALS_LABEL.exec(line);
    if (totals !== null) {
      flushPendingOnto(doc.lines[doc.lines.length - 1]);
      inTable = false;
      const label = totals[1]?.trim().toLowerCase() ?? "";
      const amount = totals[2];
      if (amount !== undefined) {
        const value = Number(amount.replace(/,/g, ""));
        if (Number.isFinite(value)) doc.printedTotals.push({ label, value });
      }
      continue;
    }
    const term = TERM_LINE.exec(line);
    if (term !== null && term[1] !== undefined && term[2] !== undefined) {
      doc.terms.push({ label: term[1].trim(), value: term[2].trim() });
      continue;
    }
    if (!inTable) continue;
    if (TABLE_HEADER_TAIL.test(line)) continue;
    const parsed = parseQuotationLine(line);
    if (parsed !== null) {
      if (pendingText.length > 0)
        parsed.description = [...pendingText, parsed.description]
          .filter((part) => part !== "")
          .join(" ");
      pendingText = [];
      doc.lines.push(parsed);
      continue;
    }
    // Only a row that looks like it was meant to be an item is worth a
    // person's attention: it has words and it has figures.
    if (
      ENDS_WITH_FIGURE.test(line) &&
      numbersIn(line).length >= 3 &&
      /[A-Za-z؀-ۿ]{3}/.test(line)
    ) {
      doc.unreconciledRows.push(line);
      continue;
    }
    // A wrapped half. Bounded, so a note printed inside the table cannot run
    // away with the description.
    if (
      /[A-Za-z؀-ۿ]{3}/.test(line) &&
      line.length <= 120 &&
      pendingText.length < 2
    )
      pendingText.push(line);
  }
  flushPendingOnto(doc.lines[doc.lines.length - 1]);

  doc.subtotal = doc.lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return doc;
}

/**
 * Do the lines that were read add up to the total the document printed?
 *
 * This is the check worth showing a person before they accept an import. Over
 * the 167 sample quotations it holds for 142 of the 144 that print a total,
 * and the two it does not hold for are the same document twice — one whose
 * transportation row the parser had already flagged, and whose shortfall is
 * exactly that row. A reading that silently disagreed with the paper would be
 * the dangerous outcome; this makes the disagreement the first thing seen.
 */
export function reconcilesWithPrintedTotal(
  doc: ParsedQuotationDocument,
): boolean | null {
  const printed = doc.printedTotals
    .filter((total) => total.label === "total")
    .reduce((sum, total) => sum + total.value, 0);
  if (printed <= 0) return null;
  return Math.abs(printed - doc.subtotal) <= Math.max(1, printed * 0.001);
}
