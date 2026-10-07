/* eslint-disable @typescript-eslint/consistent-type-imports */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

export const IMPORT_LIMITS = {
  bytes: 104_857_600,
  rows: 250_000,
  columns: 200,
} as const;
export class ImportFileProblem extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export interface ParsedImport {
  fileSha256: string;
  schemaFingerprint: string;
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
}

export async function parseImportFile(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<ParsedImport> {
  if (
    fileName.length < 1 ||
    fileName.length > 180 ||
    fileName.includes("\0") ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..") ||
    // Filename hardening intentionally rejects ASCII control characters.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(fileName)
  )
    invalid("IMPORT_FILENAME_REJECTED");
  if (buffer.length < 1 || buffer.length > IMPORT_LIMITS.bytes)
    invalid("IMPORT_FILE_SIZE_INVALID");
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if ([".zip", ".xlsm", ".xlsb", ".xls", ".exe"].includes(extension))
    invalid("IMPORT_FILE_TYPE_REJECTED");
  let matrix: unknown[][];
  if (extension === ".csv") {
    if (
      !["text/csv", "application/csv", "text/plain"].includes(
        mimeType.toLowerCase(),
      )
    )
      invalid("IMPORT_MIME_MISMATCH");
    if (buffer.includes(0)) invalid("IMPORT_CSV_BINARY_REJECTED");
    matrix = parseCsv(buffer.toString("utf8"));
  } else if (extension === ".xlsx") {
    if (
      ![
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
      ].includes(mimeType.toLowerCase())
    )
      invalid("IMPORT_MIME_MISMATCH");
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      invalid("IMPORT_XLSX_SIGNATURE_INVALID");
    const ExcelJS = createRequire(import.meta.url)(
      "exceljs",
    ) as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    if (workbook.worksheets.length !== 1)
      invalid("IMPORT_XLSX_SINGLE_SHEET_REQUIRED");
    const sheet = workbook.worksheets[0];
    if (!sheet) invalid("IMPORT_XLSX_EMPTY");
    matrix = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values: unknown[] = [];
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const cell = row.getCell(column);
        if (cell.formula || cell.hyperlink)
          invalid("IMPORT_XLSX_ACTIVE_CONTENT_REJECTED");
        values.push(normalizeCell(cell.value));
      }
      matrix.push(values);
    });
  } else invalid("IMPORT_FILE_TYPE_REJECTED");
  if (matrix.length < 2) invalid("IMPORT_SCHEMA_EMPTY");
  if (matrix.length - 1 > IMPORT_LIMITS.rows)
    invalid("IMPORT_ROW_LIMIT_EXCEEDED");
  const headerRow = matrix[0];
  if (!headerRow) invalid("IMPORT_SCHEMA_EMPTY");
  const headers = headerRow.map(headerText);
  if (
    headers.length < 1 ||
    headers.length > IMPORT_LIMITS.columns ||
    headers.some((h) => h.length === 0)
  )
    invalid("IMPORT_HEADER_INVALID");
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length)
    invalid("IMPORT_HEADER_DUPLICATE");
  const rows = matrix
    .slice(1)
    .map((cells) =>
      Object.fromEntries(
        headers.map((header, index) => [header, scalar(cells[index])]),
      ),
    );
  return {
    fileSha256: hash(buffer),
    schemaFingerprint: hash(
      Buffer.from(JSON.stringify(headers.map((h) => h.toLowerCase()))),
    ),
    headers,
    rows,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) invalid("IMPORT_CSV_UNCLOSED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
function normalizeCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object")
    invalid("IMPORT_XLSX_COMPLEX_CELL_REJECTED");
  return value;
}
function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(value))
    invalid("IMPORT_SPREADSHEET_FORMULA_REJECTED");
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : value == null
      ? null
      : invalid("IMPORT_CELL_TYPE_INVALID");
}
function headerText(value: unknown): string {
  if (value == null) return "";
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    invalid("IMPORT_HEADER_INVALID");
  return String(value).trim();
}
function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function invalid(code: string): never {
  throw new ImportFileProblem(code);
}
