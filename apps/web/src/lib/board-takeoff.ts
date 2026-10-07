/**
 * Browser mirror of apps/api/src/quotation/board-takeoff.ts, kept identical so
 * the studio's live preview and the server's authoritative save cannot
 * disagree. Same pattern as circular-column.ts / engineering-pricing.ts.
 *
 * Board take-off: the pieces an item is cut into, and their real sizes.
 *
 * A rectangular column is not a sheet. You know its height and the width of
 * each of its four, six or eight faces, and the panels come off the standard
 * board. A wall is one face, a core is four, a curve is a developed arc. Each
 * needs a take-off before it can be weighed or priced, and doing it on a
 * calculator beside the quotation is where errors come from.
 *
 * TWO RULES FROM THE SHOP FLOOR, both of which the first version of this file
 * got wrong:
 *
 *  1. THERE IS NO WASTE. ACROW cuts every piece to the customer's dimensions;
 *     the last panel in a run is cut to the remainder, not thrown away. So the
 *     material consumed is exactly the surface covered, and this module reports
 *     the cut sizes rather than a count of whole boards and an offcut figure.
 *     Anything that rounds area up is quoting for material that is never used.
 *
 *  2. A CURVE IS AN ARC, NOT A CIRCLE. The Engineering Studio's own
 *     `curve_arc_length` is `π × diameter × angle / 360`
 *     (src/registries/equation-registry.js). A 90° bend on a 1000 mm column is
 *     a quarter of the circumference, and treating it as the whole ring
 *     quadruples the quotation.
 *
 * Board counts are integers out of ceil() and every dimension is a millimetre,
 * so plain numbers carry no precision risk and the browser runs the identical
 * code (apps/web/src/lib/board-takeoff.ts). Money stays in Decimal on the
 * pricing side.
 */

export type BoardTakeoffClass =
  "STANDARD" | "REGULAR" | "CURVED" | "CIRCULAR" | "CORE" | "WALL";

/** Which way the standard board sits on the panel being covered. */
export type BoardOrientation = "LONG_SIDE_VERTICAL" | "LONG_SIDE_HORIZONTAL";

export interface ReferenceBoard {
  widthMm: number;
  lengthMm: number;
}

export const DEFAULT_REFERENCE_BOARD: ReferenceBoard = {
  widthMm: 1220,
  lengthMm: 2440,
};

/** One rectangular surface to be covered, and how many of it there are. */
export interface TakeoffFace {
  label: string;
  widthMm: number;
  heightMm: number;
  count: number;
}

/** A distinct cut size and how many of it this face needs. */
export interface TakeoffPiece {
  widthMm: number;
  heightMm: number;
  count: number;
  /** False when the piece is a remainder cut down from a full board. */
  fullBoard: boolean;
}

export interface FaceTakeoff extends TakeoffFace {
  boardsAcross: number;
  boardsUp: number;
  boardsPerFace: number;
  boards: number;
  areaMm2: number;
  pieces: TakeoffPiece[];
}

export interface BoardTakeoff {
  /** Whether this class needs a take-off at all. STANDARD does not. */
  derived: boolean;
  orientation: BoardOrientation;
  referenceBoard: ReferenceBoard;
  faces: FaceTakeoff[];
  /** Pieces for one unit of the item (one column, one wall, one core). */
  boardsPerUnit: number;
  /** boardsPerUnit x quantity — what actually gets cut. */
  totalBoards: number;
  /** Surface covered for one unit. Equals the material used: nothing is wasted. */
  coveredAreaMm2: number;
  /** Every distinct cut size across the whole item, for one unit. */
  cutList: TakeoffPiece[];
  notes: string[];
}

export interface BoardTakeoffInput {
  materialClass: BoardTakeoffClass;
  quantity: number;
  referenceBoard?: ReferenceBoard | undefined;
  orientation?: BoardOrientation | undefined;
  /** STANDARD / CORE / WALL / CURVED panel geometry. */
  thicknessMm?: number | undefined;
  widthMm?: number | undefined;
  lengthMm?: number | undefined;
  /** Column and wall height. */
  heightMm?: number | undefined;
  /** REGULAR: the width of each face, one entry per side (4, 6 or 8). */
  sideWidthsMm?: readonly number[] | undefined;
  /** CURVED: the developed arc length, when it is measured rather than derived. */
  arcLengthMm?: number | undefined;
  /** CURVED / CIRCULAR: the diameter the arc is struck on. */
  diameterMm?: number | undefined;
  /** CURVED / CIRCULAR: how much of the circle the piece covers. 360 = a full column. */
  arcAngleDeg?: number | undefined;
}

const positive = (value: number | undefined | null): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** The number of faces a rectangular column may legally have (spec: 4, 6 or 8). */
export const ALLOWED_COLUMN_SIDE_COUNTS = [4, 6, 8] as const;

/**
 * Developed length of an arc, matching the Engineering Studio's
 * `curve_arc_length`. A missing or out-of-range angle is treated as a full
 * circle, which is what a circular column is.
 */
export function arcLengthMm(diameterMm: number, angleDeg?: number): number {
  const diameter = positive(diameterMm);
  if (diameter === 0) return 0;
  const angle =
    typeof angleDeg === "number" && Number.isFinite(angleDeg) && angleDeg > 0
      ? Math.min(360, angleDeg)
      : 360;
  return (Math.PI * diameter * angle) / 360;
}

/**
 * Splits a run into the pieces actually cut from it: as many full board widths
 * as fit, then the remainder cut to size. The remainder is a piece, not waste.
 */
function splitRun(totalMm: number, boardMm: number): number[] {
  if (totalMm <= 0 || boardMm <= 0) return [];
  const full = Math.floor(totalMm / boardMm);
  const remainder = totalMm - full * boardMm;
  const runs = Array.from({ length: full }, () => boardMm);
  // A hair of remainder is a measurement artefact, not a panel to cut.
  if (remainder > 0.5) runs.push(remainder);
  return runs;
}

function tileFace(
  face: TakeoffFace,
  board: ReferenceBoard,
  orientation: BoardOrientation,
): FaceTakeoff {
  const acrossMm =
    orientation === "LONG_SIDE_VERTICAL" ? board.widthMm : board.lengthMm;
  const upMm =
    orientation === "LONG_SIDE_VERTICAL" ? board.lengthMm : board.widthMm;

  const acrossRuns = splitRun(face.widthMm, acrossMm);
  const upRuns = splitRun(face.heightMm, upMm);
  const count = Math.max(0, Math.floor(face.count));

  // Group identical cut sizes so the list reads as a cutting instruction
  // rather than a hundred near-identical rows.
  const grouped = new Map<string, TakeoffPiece>();
  for (const runWidth of acrossRuns) {
    for (const runHeight of upRuns) {
      const key = `${runWidth.toFixed(2)}x${runHeight.toFixed(2)}`;
      const existing = grouped.get(key);
      if (existing) existing.count += count;
      else
        grouped.set(key, {
          widthMm: runWidth,
          heightMm: runHeight,
          count,
          fullBoard: runWidth === acrossMm && runHeight === upMm,
        });
    }
  }

  const boardsPerFace = acrossRuns.length * upRuns.length;
  return {
    ...face,
    boardsAcross: acrossRuns.length,
    boardsUp: upRuns.length,
    boardsPerFace,
    boards: boardsPerFace * count,
    areaMm2: face.widthMm * face.heightMm * count,
    pieces: [...grouped.values()],
  };
}

/** The faces each class presents, before any cutting happens. */
function facesFor(input: BoardTakeoffInput): {
  faces: TakeoffFace[];
  notes: string[];
} {
  const notes: string[] = [];
  const height = positive(input.heightMm);

  switch (input.materialClass) {
    case "REGULAR": {
      const sides = (input.sideWidthsMm ?? [])
        .map(positive)
        .filter((s) => s > 0);
      if (sides.length === 0 || height === 0) return { faces: [], notes };
      if (!ALLOWED_COLUMN_SIDE_COUNTS.includes(sides.length as 4 | 6 | 8)) {
        notes.push(
          `A rectangular column is quoted with 4, 6 or 8 faces; ${String(sides.length)} were given.`,
        );
      }
      return {
        faces: sides.map((widthMm, index) => ({
          label: `Face ${String(index + 1)}`,
          widthMm,
          heightMm: height,
          count: 1,
        })),
        notes,
      };
    }

    case "CORE": {
      // A core is a closed rectangular shaft: the formwork wraps all four
      // inner faces, so the two lengths and the two widths are each covered.
      const lengthMm = positive(input.lengthMm);
      const widthMm = positive(input.widthMm);
      if (lengthMm === 0 || widthMm === 0 || height === 0)
        return { faces: [], notes };
      return {
        faces: [
          {
            label: "Long faces",
            widthMm: lengthMm,
            heightMm: height,
            count: 2,
          },
          { label: "Short faces", widthMm, heightMm: height, count: 2 },
        ],
        notes,
      };
    }

    case "WALL": {
      const lengthMm = positive(input.lengthMm);
      if (lengthMm === 0 || height === 0) return { faces: [], notes };
      return {
        faces: [
          { label: "Wall face", widthMm: lengthMm, heightMm: height, count: 1 },
        ],
        notes,
      };
    }

    case "CURVED":
    case "CIRCULAR": {
      // Measured arc wins over a derived one: if someone has the developed
      // length off a drawing, that is better than any diameter we infer.
      const measured = positive(input.arcLengthMm);
      const derived = arcLengthMm(
        positive(input.diameterMm),
        input.arcAngleDeg,
      );
      const developed = measured > 0 ? measured : derived;
      if (developed === 0 || height === 0) return { faces: [], notes };
      if (measured === 0 && derived > 0) {
        const angle =
          typeof input.arcAngleDeg === "number" && input.arcAngleDeg > 0
            ? Math.min(360, input.arcAngleDeg)
            : 360;
        notes.push(
          `Developed arc ${developed.toFixed(0)} mm = π × ${String(positive(input.diameterMm))} mm × ${String(angle)}° / 360.`,
        );
      }
      return {
        faces: [
          {
            label: "Developed arc",
            widthMm: developed,
            heightMm: height,
            count: 1,
          },
        ],
        notes,
      };
    }

    case "STANDARD":
    default:
      return { faces: [], notes };
  }
}

/** Curved and circular work stows the board on edge, 2440 along the arc. */
export function defaultOrientationFor(
  materialClass: BoardTakeoffClass,
): BoardOrientation {
  return materialClass === "CURVED" || materialClass === "CIRCULAR"
    ? "LONG_SIDE_HORIZONTAL"
    : "LONG_SIDE_VERTICAL";
}

export function computeBoardTakeoff(input: BoardTakeoffInput): BoardTakeoff {
  const referenceBoard = input.referenceBoard ?? DEFAULT_REFERENCE_BOARD;
  const orientation =
    input.orientation ?? defaultOrientationFor(input.materialClass);
  const quantity = Math.max(0, Math.floor(input.quantity));
  const { faces: rawFaces, notes } = facesFor(input);

  // A flat sheet is already a board: there is nothing to take off, and
  // pretending otherwise would double-count it.
  if (input.materialClass === "STANDARD" || rawFaces.length === 0) {
    return {
      derived: false,
      orientation,
      referenceBoard,
      faces: [],
      boardsPerUnit: 0,
      totalBoards: 0,
      coveredAreaMm2: 0,
      cutList: [],
      notes,
    };
  }

  const faces = rawFaces.map((face) =>
    tileFace(face, referenceBoard, orientation),
  );
  const boardsPerUnit = faces.reduce((sum, face) => sum + face.boards, 0);

  const cutList = new Map<string, TakeoffPiece>();
  for (const face of faces) {
    for (const piece of face.pieces) {
      const key = `${piece.widthMm.toFixed(2)}x${piece.heightMm.toFixed(2)}`;
      const existing = cutList.get(key);
      if (existing) existing.count += piece.count;
      else cutList.set(key, { ...piece });
    }
  }

  return {
    derived: true,
    orientation,
    referenceBoard,
    faces,
    boardsPerUnit,
    totalBoards: boardsPerUnit * quantity,
    coveredAreaMm2: faces.reduce((sum, face) => sum + face.areaMm2, 0),
    cutList: [...cutList.values()].sort(
      (a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm,
    ),
    notes,
  };
}
