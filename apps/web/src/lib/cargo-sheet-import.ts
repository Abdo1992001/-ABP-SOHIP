/**
 * Reading a filled-in cargo loading sheet.
 *
 * The sheet is ABP's own (`public/templates/abp-cargo-boards.xlsx`), but a
 * salesperson will open it in Excel, add rows, move columns, rename a header,
 * paste from somewhere else and save it again. So the import matches columns by
 * what their heading says rather than by where they sit, and it reports what it
 * could not read instead of quietly dropping it.
 *
 * Two rules decide the weight, and they are the same two the screen uses:
 *
 *   - A **stated** weight is used exactly as given. It is what the shipment is
 *     weighed against, and somebody is standing behind it.
 *   - Otherwise the weight is **derived** from the density and the three
 *     dimensions, the way the workbook derives it.
 *
 * A row is skipped only when it cannot describe a board at all. Everything else
 * comes through with a problem attached, because a row silently missing from a
 * shipment is worse than a row somebody has to look at.
 */

import { boardWeightKg, densityLooksWrong } from "./board-weight.ts";
import { WORKBOOK } from "./workbook-defaults.ts";

/** One row of the sheet, as the cargo loader wants it. */
export interface ImportedBoard {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly thicknessMm: number;
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly densityKgM3: number;
  /** Zero when the sheet left it blank, which means "work it out". */
  readonly unitWeightKg: number;
  readonly quantity: number;
}

export interface ImportProblem {
  /** The sheet's own row number, so a person can go and look at it. */
  readonly row: number;
  readonly message: string;
  /** A problem worth stopping for, against one worth knowing about. */
  readonly severity: "SKIPPED" | "WARNING";
}

export interface ImportResult {
  readonly boards: ImportedBoard[];
  readonly problems: ImportProblem[];
  /** Rows that held something but described no board. */
  readonly skipped: number;
}

/** What each column may be called. First match wins, and case is ignored. */
const COLUMNS = {
  code: ["item code", "code", "sku", "item no", "item number", "part no"],
  description: ["description", "item", "board", "product"],
  thicknessMm: ["thickness", "thick", "t", "thickness (mm)"],
  widthMm: ["width", "w", "width (mm)"],
  lengthMm: ["length", "l", "length (mm)"],
  densityKgM3: ["density", "density (kg/m3)", "kg/m3", "kg/m³"],
  unitWeightKg: [
    "weight / board",
    "weight/board",
    "unit weight",
    "weight per board",
    "kg/board",
    "weight",
  ],
  quantity: ["quantity", "qty", "boards", "pcs", "pieces", "count"],
} as const;

type Field = keyof typeof COLUMNS;

function normalise(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/\(kg\)|\(mm\)|\(kg\/m3\)|\(kg\/m³\)/g, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

/**
 * Which column holds which field, read off the heading row.
 *
 * Longest alias first, so "weight / board" is not claimed by "weight".
 */
export function mapColumns(
  headings: readonly string[],
): Partial<Record<Field, number>> {
  const found: Partial<Record<Field, number>> = {};
  const seen = new Set<number>();
  const fields = Object.keys(COLUMNS) as Field[];
  for (const field of fields) {
    const aliases = [...COLUMNS[field]].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const index = headings.findIndex(
        (heading, position) =>
          !seen.has(position) && normalise(heading) === normalise(alias),
      );
      if (index !== -1) {
        found[field] = index;
        seen.add(index);
        break;
      }
    }
  }
  return found;
}

/**
 * Where the heading row is.
 *
 * ABP's own sheet puts it on row 9, under the logo and the notes, but a sheet
 * that has been edited or pasted from elsewhere puts it anywhere. The heading
 * row is the first one that names at least a description and a quantity.
 */
export function findHeaderRow(rows: readonly (readonly unknown[])[]): number {
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const row = rows[index] ?? [];
    const headings = row.map((cell) => toText(cell));
    const mapped = mapColumns(headings);
    if (mapped.description !== undefined && mapped.quantity !== undefined)
      return index;
  }
  return -1;
}

/**
 * A cell as text.
 *
 * A spreadsheet cell is not always a string: a hyperlink or a rich-text run
 * comes back as an object with the words inside it, and `String()` on one of
 * those gives "[object Object]" — which would then be imported as a board's
 * description.
 */
function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text.trim();
    if (typeof record.result === "string") return record.result.trim();
    if (Array.isArray(record.richText))
      return record.richText
        .map((part) => {
          if (typeof part !== "object" || part === null) return "";
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .join("")
        .trim();
  }
  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  // A sheet may carry "1,220" or "1 220 mm"; the digits are what matters.
  const text = toText(value);
  if (text === "") return 0;
  const cleaned = text.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Read a sheet's rows into boards. */
export function importCargoSheet(
  rows: readonly (readonly unknown[])[],
): ImportResult {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1)
    return {
      boards: [],
      problems: [
        {
          row: 0,
          severity: "SKIPPED",
          message:
            "No heading row found. The sheet needs a row naming at least a Description and a Quantity column.",
        },
      ],
      skipped: 0,
    };

  const headings = (rows[headerIndex] ?? []).map((cell) => toText(cell));
  const columns = mapColumns(headings);
  const boards: ImportedBoard[] = [];
  const problems: ImportProblem[] = [];
  let skipped = 0;

  const read = (row: readonly unknown[], field: Field): unknown => {
    const index = columns[field];
    return index === undefined ? undefined : row[index];
  };

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    // The sheet's own numbering, which is what a person sees in Excel.
    const rowNumber = index + 1;
    const description = toText(read(row, "description"));
    const quantity = Math.round(toNumber(read(row, "quantity")));
    const thicknessMm = toNumber(read(row, "thicknessMm"));
    const widthMm = toNumber(read(row, "widthMm"));
    const lengthMm = toNumber(read(row, "lengthMm"));

    const empty =
      description === "" &&
      quantity === 0 &&
      thicknessMm === 0 &&
      widthMm === 0 &&
      lengthMm === 0;
    if (empty) continue;

    // Prose, not an attempted board: the sheet's own footer, a section
    // heading somebody typed, a note in the margin. A row with words and not
    // one number anywhere was never trying to be a board, and reporting it as
    // a failed one buries the rows that were.
    const hasAnyNumber = [
      thicknessMm,
      widthMm,
      lengthMm,
      quantity,
      toNumber(read(row, "densityKgM3")),
      toNumber(read(row, "unitWeightKg")),
    ].some((value) => value > 0);
    if (!hasAnyNumber) continue;

    if (thicknessMm <= 0 || widthMm <= 0 || lengthMm <= 0) {
      skipped += 1;
      problems.push({
        row: rowNumber,
        severity: "SKIPPED",
        message: `“${description || "(no description)"}” has no usable size. A board needs a thickness, a width and a length.`,
      });
      continue;
    }
    if (quantity <= 0) {
      skipped += 1;
      problems.push({
        row: rowNumber,
        severity: "SKIPPED",
        message: `“${description || "(no description)"}” has no quantity.`,
      });
      continue;
    }

    const stated = toNumber(read(row, "unitWeightKg"));
    const densityRead = toNumber(read(row, "densityKgM3"));
    const densityKgM3 = densityRead > 0 ? densityRead : WORKBOOK.densityKgM3;
    if (densityRead <= 0)
      problems.push({
        row: rowNumber,
        severity: "WARNING",
        message: `No density on this row; ${String(WORKBOOK.densityKgM3)} kg/m³ was used.`,
      });
    else if (densityLooksWrong(densityKgM3))
      problems.push({
        row: rowNumber,
        severity: "WARNING",
        message: `A density of ${String(densityKgM3)} kg/m³ is not a board — check the decimal point.`,
      });

    const weight = boardWeightKg({
      thicknessMm,
      widthMm,
      lengthMm,
      densityKgM3,
      statedKg: stated,
    });
    if (weight.kg <= 0)
      problems.push({
        row: rowNumber,
        severity: "WARNING",
        message: "This board weighs nothing; its plan will be wrong.",
      });

    boards.push({
      id: `X${String(rowNumber)}`,
      code: toText(read(row, "code")),
      description:
        description === ""
          ? `${String(thicknessMm)} × ${String(widthMm)} × ${String(lengthMm)} mm`
          : description,
      thicknessMm,
      widthMm,
      lengthMm,
      densityKgM3,
      // Zero keeps "derive it" downstream; a stated figure is passed through.
      unitWeightKg: weight.source === "STATED" ? weight.kg : 0,
      quantity,
    });
  }

  return { boards, problems, skipped };
}
