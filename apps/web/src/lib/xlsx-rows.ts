import type { Worksheet } from "exceljs";

const RANGE = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/;

/** "J25:L25" moved down by `by` rows, or null when it is not a range. */
export function shiftRange(range: string, by: number): string | null {
  const match = RANGE.exec(range);
  if (match === null) return null;
  const [, c1, r1, c2, r2] = match;
  if (
    c1 === undefined ||
    r1 === undefined ||
    c2 === undefined ||
    r2 === undefined
  )
    return null;
  return `${c1}${String(Number(r1) + by)}:${c2}${String(Number(r2) + by)}`;
}

/** The first row a range covers. */
export function firstRowOf(range: string): number {
  const match = RANGE.exec(range);
  return match?.[2] === undefined ? Number.NaN : Number(match[2]);
}

/**
 * Copies of one row inserted below it, with every merge further down carried
 * along.
 *
 * ExcelJS moves the cells when rows are inserted and leaves the merges where
 * they were. The quotation's totals sit below its ten line rows in merged
 * cells, so an eleventh line pushed the totals down and left their merges on
 * top of the new line rows -- the next merge there failed with "Cannot merge
 * already merged cells" and no quotation of more than ten lines could be
 * saved as Excel. The merges below are taken off first and put back where
 * their cells went.
 */
export function insertRowsKeepingMerges(
  sheet: Worksheet,
  row: number,
  count: number,
): void {
  if (count <= 0) return;
  const below = sheet.model.merges.filter((range) => firstRowOf(range) > row);
  for (const range of below) sheet.unMergeCells(range);
  sheet.duplicateRow(row, count, true);
  for (const range of below) {
    const moved = shiftRange(range, count);
    if (moved !== null) sheet.mergeCells(moved);
  }
}
