/**
 * A saved column or circular line, rebuilt from what the server kept.
 *
 * The server saves a column as the panels it produces -- sixteen panels at an
 * average price -- and a quotation opened again used to start the column's
 * own inputs blank. With no sides and no height the screen priced it at zero
 * panels, so a reopened quotation showed 0.00 for every column and a subtotal
 * short by exactly those lines; and pressing Save sent the column back with no
 * sides, which the server refuses.
 *
 * Everything needed is in the price snapshot. Quotations saved from now on
 * carry the typed inputs themselves; older ones carry what they produced, and
 * the inputs follow from it:
 *
 *   - a rectangular column's faces are A, B, A+closure, B+closure, so A and B
 *     are its first two faces;
 *   - a column's height is its lifts added up;
 *   - a circular column's height is each piece's height times how many of it
 *     one column takes, over how many pieces make one course; and its mould
 *     segments are its pieces per column over arc pieces times courses.
 *
 * The count is put back as the number of columns, because that is what the
 * schedule multiplies -- the saved `qty` is the panel count the server derived
 * from it.
 */

export interface RestoredGeometry {
  qty?: string;
  sideAMm?: string;
  sideBMm?: string;
  columnHeightMm?: string;
  curvedFaceNumbers?: number[];
  diameterMm?: string;
  radiusMm?: string;
  mouldSegments?: string;
  arcModuleMm?: string;
  verticalCourseMm?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** A figure as the inputs hold it: no trailing ".0000". */
function text(value: number | null): string | undefined {
  return value === null ? undefined : String(Number(value.toFixed(4)));
}

export function restoreLineGeometry(snapshot: unknown): RestoredGeometry {
  if (!isRecord(snapshot)) return {};

  const column = isRecord(snapshot.column) ? snapshot.column : null;
  if (column !== null) {
    const faces = Array.isArray(column.faceWidthsMm)
      ? column.faceWidthsMm.map(num)
      : [];
    const lifts = Array.isArray(column.courseLengthsMm)
      ? column.courseLengthsMm.map(num).filter((n): n is number => n !== null)
      : [];
    const rectangular = column.shape !== "IRREGULAR";
    const height =
      num(column.columnHeightMm) ??
      (lifts.length > 0 ? lifts.reduce((sum, lift) => sum + lift, 0) : null);
    const restored: RestoredGeometry = {};
    const qty = text(num(column.columnQuantity));
    if (qty !== undefined) restored.qty = qty;
    const heightText = text(height);
    if (heightText !== undefined) restored.columnHeightMm = heightText;
    if (rectangular) {
      const a = text(num(column.sideAMm) ?? faces[0] ?? null);
      const b = text(num(column.sideBMm) ?? faces[1] ?? null);
      if (a !== undefined) restored.sideAMm = a;
      if (b !== undefined) restored.sideBMm = b;
    }
    if (Array.isArray(column.curvedFaceNumbers))
      restored.curvedFaceNumbers = column.curvedFaceNumbers
        .map(num)
        .filter((n): n is number => n !== null);
    return restored;
  }

  const circular = isRecord(snapshot.circular) ? snapshot.circular : null;
  if (circular !== null) {
    const pieces = Array.isArray(circular.pieces)
      ? circular.pieces.filter(isRecord)
      : [];
    const perColumn = num(circular.piecesPerColumn);
    const courses = num(circular.verticalCourseCount);
    const arcPieces = num(circular.arcPieceCount);
    const perCourse =
      perColumn !== null && courses !== null && courses > 0
        ? perColumn / courses
        : null;
    const derivedHeight =
      perCourse !== null && perCourse > 0
        ? pieces.reduce(
            (sum, piece) =>
              sum +
              (num(piece.heightMm) ?? 0) * (num(piece.countPerColumn) ?? 0),
            0,
          ) / perCourse
        : null;
    const derivedSegments =
      perColumn !== null &&
      arcPieces !== null &&
      courses !== null &&
      arcPieces > 0 &&
      courses > 0
        ? perColumn / (arcPieces * courses)
        : null;
    const restored: RestoredGeometry = {};
    const set = (key: keyof RestoredGeometry, value: number | null) => {
      const shown = text(value);
      if (shown !== undefined)
        (restored as Record<string, string>)[key] = shown;
    };
    set("qty", num(circular.columnQuantity));
    set("columnHeightMm", num(circular.columnHeightMm) ?? derivedHeight);
    set("mouldSegments", num(circular.mouldSegments) ?? derivedSegments);
    set("diameterMm", num(circular.diameterMm));
    set("radiusMm", num(circular.radiusMm));
    set("arcModuleMm", num(circular.arcModuleMm));
    set("verticalCourseMm", num(circular.verticalCourseMm));
    return restored;
  }

  return {};
}
