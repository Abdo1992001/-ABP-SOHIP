import { Prisma } from "@abp/database";

/**
 * Circular column piece-count engine. Given just a diameter (or radius) and
 * a column height, derives the full delivered-piece schedule automatically —
 * the sales rep never computes arc pieces / courses by hand. Each derived
 * piece is arcModuleMm x verticalCourseMm x thickness, priced through the
 * normal WEIGHT_BASED formula (engineering-pricing.ts) using these as the
 * piece's length/width.
 */

export interface CircularColumnInput {
  diameterMm?: Prisma.Decimal | null | undefined;
  radiusMm?: Prisma.Decimal | null | undefined;
  columnHeightMm: Prisma.Decimal;
  mouldSegments?: number | undefined;
  arcModuleMm?: Prisma.Decimal | undefined;
  verticalCourseMm?: Prisma.Decimal | undefined;
  columnQuantity: number;
}

/**
 * One delivered piece size and how many of it the schedule needs.
 *
 * A column is not cut into arc modules of a fixed 2440 mm: the last piece on
 * every run is cut to the remainder (spec SS13, MAX + REMAINDER). A 1200 mm
 * column has a 1884.96 mm working arc, which is ONE piece 1885 mm wide -- not
 * a full 2440 mm module. Pricing the module instead of the piece overcharges
 * that column by 29%, so the delivered width is what gets weighed and priced.
 *
 * Widths and heights are rounded to whole millimetres: a board is cut to a
 * drawing dimension, and the drawing says 1885, not 1884.9555921538758.
 */
export interface CircularPieceGroup {
  /** Along the arc. */
  widthMm: Prisma.Decimal;
  /** The vertical course. */
  heightMm: Prisma.Decimal;
  /** How many of this size one column needs. */
  countPerColumn: number;
  /** countPerColumn x columnQuantity. */
  totalCount: number;
  /** False when this piece is a remainder cut down from a full module. */
  fullModule: boolean;
}

export interface CircularColumnSchedule {
  diameterMm: Prisma.Decimal;
  radiusMm: Prisma.Decimal;
  circumferenceMm: Prisma.Decimal;
  workingArcMm: Prisma.Decimal;
  arcPieceCount: number;
  verticalCourseCount: number;
  piecesPerColumn: number;
  totalPieces: number;
  arcModuleMm: Prisma.Decimal;
  verticalCourseMm: Prisma.Decimal;
  /** The distinct delivered piece sizes, largest first. */
  pieces: CircularPieceGroup[];
}

const DEFAULT_MOULD_SEGMENTS = 2;
const DEFAULT_ARC_MODULE_MM = new Prisma.Decimal("2440");
const DEFAULT_VERTICAL_COURSE_MM = new Prisma.Decimal("1200");
const PI = new Prisma.Decimal("3.14159265358979323846");

function ceilDecimal(value: Prisma.Decimal): number {
  return Math.ceil(value.toNumber());
}

/**
 * Splits a run into the pieces actually cut from it: as many full modules as
 * fit, then the remainder cut to size. Mirrors board-takeoff.ts's own splitRun
 * -- ACROW cuts to the customer's dimension, so the remainder is a piece, not
 * waste.
 */
function splitRun(
  totalMm: Prisma.Decimal,
  moduleMm: Prisma.Decimal,
): Prisma.Decimal[] {
  if (totalMm.lessThanOrEqualTo(0) || moduleMm.lessThanOrEqualTo(0)) return [];
  const full = Math.floor(totalMm.div(moduleMm).toNumber());
  const remainder = totalMm.minus(moduleMm.mul(full));
  const runs: Prisma.Decimal[] = Array.from({ length: full }, () => moduleMm);
  // Half a millimetre of remainder is a rounding artefact, not a panel to cut.
  if (remainder.greaterThan("0.5")) runs.push(remainder);
  return runs;
}

/** Delivered dimensions are drawing dimensions: whole millimetres. */
function toWholeMm(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}

export function computeCircularColumnSchedule(
  input: CircularColumnInput,
): CircularColumnSchedule {
  const diameterMm =
    input.diameterMm != null
      ? input.diameterMm
      : input.radiusMm != null
        ? input.radiusMm.mul(2)
        : new Prisma.Decimal(0);
  const radiusMm = diameterMm.div(2);
  const mouldSegments = Math.max(
    1,
    Math.floor(input.mouldSegments ?? DEFAULT_MOULD_SEGMENTS),
  );
  const arcModuleMm = input.arcModuleMm ?? DEFAULT_ARC_MODULE_MM;
  const verticalCourseMm = input.verticalCourseMm ?? DEFAULT_VERTICAL_COURSE_MM;

  const circumferenceMm = diameterMm.mul(PI);
  const workingArcMm = circumferenceMm.div(mouldSegments);
  const arcPieceCount = arcModuleMm.greaterThan(0)
    ? ceilDecimal(workingArcMm.div(arcModuleMm))
    : 0;
  const verticalCourseCount = verticalCourseMm.greaterThan(0)
    ? ceilDecimal(input.columnHeightMm.div(verticalCourseMm))
    : 0;
  const piecesPerColumn = arcPieceCount * mouldSegments * verticalCourseCount;
  const columnQuantity = Math.max(0, Math.floor(input.columnQuantity));
  const totalPieces = piecesPerColumn * columnQuantity;

  // Every (arc run x course run) pair is one delivered piece, once per mould
  // segment. Identical sizes are grouped so the schedule reads as a cutting
  // list rather than a hundred near-identical rows (spec SS17).
  const grouped = new Map<string, CircularPieceGroup>();
  for (const arcRun of splitRun(workingArcMm, arcModuleMm)) {
    for (const courseRun of splitRun(input.columnHeightMm, verticalCourseMm)) {
      const widthMm = toWholeMm(arcRun);
      const heightMm = toWholeMm(courseRun);
      const key = `${widthMm.toString()}x${heightMm.toString()}`;
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
        fullModule:
          arcRun.equals(arcModuleMm) && courseRun.equals(verticalCourseMm),
      });
    }
  }
  const pieces = [...grouped.values()].sort((a, b) =>
    b.widthMm.mul(b.heightMm).minus(a.widthMm.mul(a.heightMm)).toNumber(),
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
