/**
 * Client-side mirror of apps/api/src/quotation/circular-column.ts, used only
 * for the live drop-panel preview — the server always recomputes and
 * persists the authoritative schedule on save.
 */

export interface CircularColumnInput {
  diameterMm?: number | null;
  radiusMm?: number | null;
  columnHeightMm: number;
  mouldSegments?: number;
  arcModuleMm?: number;
  verticalCourseMm?: number;
  columnQuantity: number;
}

/** One delivered piece size and how many of it the schedule needs. */
export interface CircularPieceGroup {
  /** Along the arc. */
  widthMm: number;
  /** The vertical course. */
  heightMm: number;
  countPerColumn: number;
  totalCount: number;
  fullModule: boolean;
}

export interface CircularColumnSchedule {
  diameterMm: number;
  radiusMm: number;
  circumferenceMm: number;
  workingArcMm: number;
  arcPieceCount: number;
  verticalCourseCount: number;
  piecesPerColumn: number;
  totalPieces: number;
  arcModuleMm: number;
  verticalCourseMm: number;
  /** The distinct delivered piece sizes, largest first. */
  pieces: CircularPieceGroup[];
}

const DEFAULT_MOULD_SEGMENTS = 2;
const DEFAULT_ARC_MODULE_MM = 2440;
const DEFAULT_VERTICAL_COURSE_MM = 1200;

/** As many full modules as fit, then the remainder cut to size. */
function splitRun(totalMm: number, moduleMm: number): number[] {
  if (totalMm <= 0 || moduleMm <= 0) return [];
  const full = Math.floor(totalMm / moduleMm);
  const remainder = totalMm - full * moduleMm;
  const runs = Array.from({ length: full }, () => moduleMm);
  if (remainder > 0.5) runs.push(remainder);
  return runs;
}

export function computeCircularColumnSchedule(
  input: CircularColumnInput,
): CircularColumnSchedule {
  const diameterMm =
    input.diameterMm ?? (input.radiusMm != null ? input.radiusMm * 2 : 0);
  const radiusMm = diameterMm / 2;
  const mouldSegments = Math.max(
    1,
    Math.floor(input.mouldSegments ?? DEFAULT_MOULD_SEGMENTS),
  );
  const arcModuleMm = input.arcModuleMm ?? DEFAULT_ARC_MODULE_MM;
  const verticalCourseMm = input.verticalCourseMm ?? DEFAULT_VERTICAL_COURSE_MM;

  const circumferenceMm = diameterMm * Math.PI;
  const workingArcMm = circumferenceMm / mouldSegments;
  const arcPieceCount =
    arcModuleMm > 0 ? Math.ceil(workingArcMm / arcModuleMm) : 0;
  const verticalCourseCount =
    verticalCourseMm > 0
      ? Math.ceil(input.columnHeightMm / verticalCourseMm)
      : 0;
  const piecesPerColumn = arcPieceCount * mouldSegments * verticalCourseCount;
  const columnQuantity = Math.max(0, Math.floor(input.columnQuantity));
  const totalPieces = piecesPerColumn * columnQuantity;

  // The delivered piece, not the mould module it was cut from: a 1200mm
  // column's working arc is one 1885mm piece, not a full 2440mm board.
  const grouped = new Map<string, CircularPieceGroup>();
  for (const arcRun of splitRun(workingArcMm, arcModuleMm)) {
    for (const courseRun of splitRun(input.columnHeightMm, verticalCourseMm)) {
      const widthMm = Math.round(arcRun);
      const heightMm = Math.round(courseRun);
      const key = `${String(widthMm)}x${String(heightMm)}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.countPerColumn += mouldSegments;
        existing.totalCount += mouldSegments * columnQuantity;
        continue;
      }
      grouped.set(key, {
        widthMm,
        heightMm,
        countPerColumn: mouldSegments,
        totalCount: mouldSegments * columnQuantity,
        fullModule: arcRun === arcModuleMm && courseRun === verticalCourseMm,
      });
    }
  }
  const pieces = [...grouped.values()].sort(
    (a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm,
  );

  return {
    diameterMm,
    radiusMm,
    circumferenceMm,
    workingArcMm,
    arcPieceCount,
    verticalCourseCount,
    piecesPerColumn,
    totalPieces,
    arcModuleMm,
    verticalCourseMm,
    pieces,
  };
}
