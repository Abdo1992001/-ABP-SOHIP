/**
 * What a rectangular column is actually cut into.
 *
 * THE RULE THIS FILE EXISTS FOR, straight off the ACROW BOARD workbook
 * (COLUMNS tab, "Rule / Note" column: `A / B / A+20 / B+20`):
 *
 *   A column of A × B does NOT get four panels of A, B, A, B. Two opposite
 *   panels sit BETWEEN the other two, and the two that close the box have to
 *   lap the thickness of their neighbours. So the faces are
 *
 *       A,  B,  A + closure,  B + closure
 *
 *   with the closure allowance a company setting (20 mm in the workbook:
 *   SETTINGS "Regular Column Closure Allowance (mm)").
 *
 *   A 300 × 300 column is 300 | 300 | 320 | 320, not 300 × 4. Quoting it as
 *   300 × 4 is 40 mm of panel short on every column, and the formwork does
 *   not close.
 *
 * An IRREGULAR column skips the rule: its faces are measured off the drawing
 * and entered directly — six of them for a column, twenty for a core or a
 * wall, which the workbook draws with the same F01:F20 engine.
 *
 * Both are then cut the same way, MAX + REMAINDER in each direction — as many
 * full panels as fit, then the remainder cut to size. Nothing is wasted:
 * ACROW cuts to the customer's dimension.
 *
 * Pure, no DB, no Decimal — every value is a whole millimetre or a count, so
 * the browser runs the identical file (apps/web/src/lib/column-faces.ts).
 */

export type ColumnShape = "RECTANGULAR" | "IRREGULAR";

/** The workbook's own default for the closure lap, in millimetres. */
export const DEFAULT_CLOSURE_ALLOWANCE_MM = 20;
/** SETTINGS "Max Panel Width (mm)". */
export const DEFAULT_MAX_PANEL_WIDTH_MM = 1220;
/** SETTINGS "Max Panel Length (mm)" — how tall one lift of panel may be. */
export const DEFAULT_MAX_PANEL_LENGTH_MM = 2000;
/** SETTINGS "Column / Core / Wall Height (mm)". */
export const DEFAULT_COLUMN_HEIGHT_MM = 4000;
/** A drawing may name at most this many faces on an irregular column. */
export const MAX_IRREGULAR_FACES = 6;
/**
 * A core or a wall is the same engine with a bigger drawing: the workbook
 * gives both twenty face columns (F01:F20) rather than six.
 */
export const MAX_ELEMENT_FACES = 20;

export interface ColumnFaceInput {
  shape: ColumnShape;
  /** RECTANGULAR: the two plan dimensions. */
  sideAMm?: number | null | undefined;
  sideBMm?: number | null | undefined;
  /** IRREGULAR: the faces as measured. */
  faceWidthsMm?: readonly number[] | undefined;
  closureAllowanceMm?: number | undefined;
  /**
   * How many faces the drawing may name. Six for a column, twenty for a core
   * or a wall (the workbook's F01:F20).
   */
  maxFaces?: number | undefined;
}

const positive = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * The faces of one column, in the order the workbook lists them:
 * A, B, A + closure, B + closure.
 */
export function columnFaceWidths(input: ColumnFaceInput): number[] {
  if (input.shape === "IRREGULAR") {
    return (input.faceWidthsMm ?? [])
      .map(positive)
      .filter((width) => width > 0)
      .slice(0, input.maxFaces ?? MAX_IRREGULAR_FACES);
  }
  const a = positive(input.sideAMm);
  const b = positive(input.sideBMm);
  if (a === 0 || b === 0) return [];
  const closure = Math.max(
    0,
    input.closureAllowanceMm ?? DEFAULT_CLOSURE_ALLOWANCE_MM,
  );
  return [a, b, a + closure, b + closure];
}

/** One delivered panel size and how many of it the column needs. */
export interface ColumnPanelGroup {
  widthMm: number;
  /** The lift height this panel covers. */
  lengthMm: number;
  countPerColumn: number;
  totalCount: number;
  /** False when the panel is a remainder cut down from a full one. */
  fullPanel: boolean;
  /**
   * True when this panel came off a face the drawing marks as curved. A core
   * with two curved faces is two rates on one element, and the workbook says
   * so in its own "Curved Faces" column — so the schedule carries it and the
   * pricing side charges those panels at the curved rate.
   */
  curved: boolean;
}

export interface ColumnPanelSchedule {
  /** The faces this column presents, before any cutting. */
  faceWidthsMm: number[];
  /** Sum of the faces — the workbook's "Total Face / Arc Width (mm)". */
  totalFaceWidthMm: number;
  /** The workbook's "Panels / Unit": one per face, before the height split. */
  facesPerColumn: number;
  /** The workbook's "Total Panels": faces × quantity. */
  totalFaces: number;
  /** How many lifts the height is split into. */
  verticalCourses: number;
  /** The lift heights, largest first; the last may be a remainder. */
  courseLengthsMm: number[];
  /** Delivered panels for one column, after both splits. */
  panelsPerColumn: number;
  /** panelsPerColumn × quantity — what actually gets cut and quoted. */
  totalPanels: number;
  /** Every distinct delivered panel size, largest first. */
  panels: ColumnPanelGroup[];
  /** How many of the entered faces the drawing marks as curved. */
  curvedFaceCount: number;
  notes: string[];
}

export interface ColumnPanelScheduleInput extends ColumnFaceInput {
  columnHeightMm?: number | undefined;
  maxPanelWidthMm?: number | undefined;
  maxPanelLengthMm?: number | undefined;
  quantity: number;
  /**
   * Which faces the drawing marks as curved, numbered from 1 in the order they
   * were entered. The workbook's "Curved Faces" column.
   */
  curvedFaceNumbers?: readonly number[] | undefined;
  /**
   * How many faces the drawing is expected to have. The workbook's "Expected
   * Faces" column exists so a core entered with nineteen of its twenty faces
   * is caught while it is being typed, not after it is quoted.
   */
  expectedFaces?: number | undefined;
}

/**
 * As many full modules as fit, then the remainder cut to size. Half a
 * millimetre of remainder is a rounding artefact, not a panel.
 */
function splitRun(totalMm: number, moduleMm: number): number[] {
  if (totalMm <= 0 || moduleMm <= 0) return [];
  const full = Math.floor(totalMm / moduleMm);
  const remainder = totalMm - full * moduleMm;
  const runs = Array.from({ length: full }, () => moduleMm);
  if (remainder > 0.5) runs.push(Math.round(remainder));
  return runs;
}

export function computeColumnPanelSchedule(
  input: ColumnPanelScheduleInput,
): ColumnPanelSchedule {
  const notes: string[] = [];
  const faceWidthsMm = columnFaceWidths(input);
  const quantity = Math.max(0, Math.floor(input.quantity));
  const heightMm = positive(input.columnHeightMm) || DEFAULT_COLUMN_HEIGHT_MM;
  const maxPanelWidthMm =
    positive(input.maxPanelWidthMm) || DEFAULT_MAX_PANEL_WIDTH_MM;
  const maxPanelLengthMm =
    positive(input.maxPanelLengthMm) || DEFAULT_MAX_PANEL_LENGTH_MM;

  if (input.shape === "RECTANGULAR" && faceWidthsMm.length === 4) {
    const closure = input.closureAllowanceMm ?? DEFAULT_CLOSURE_ALLOWANCE_MM;
    notes.push(
      `A / B / A+${String(closure)} / B+${String(closure)} — the two closing panels lap their neighbours' thickness.`,
    );
  }
  const maxFaces = input.maxFaces ?? MAX_IRREGULAR_FACES;
  if (
    input.shape === "IRREGULAR" &&
    (input.faceWidthsMm ?? []).length > maxFaces
  ) {
    notes.push(
      `A drawing may name at most ${String(maxFaces)} faces; the rest were ignored.`,
    );
  }
  if (
    typeof input.expectedFaces === "number" &&
    input.expectedFaces > 0 &&
    input.expectedFaces !== faceWidthsMm.length
  ) {
    notes.push(
      `The drawing is expected to have ${String(input.expectedFaces)} faces, but ${String(faceWidthsMm.length)} were entered.`,
    );
  }

  const courseLengthsMm = splitRun(heightMm, maxPanelLengthMm);

  const curvedFaces = new Set(input.curvedFaceNumbers ?? []);
  const grouped = new Map<string, ColumnPanelGroup>();
  let panelsPerColumn = 0;
  for (const [faceIndex, faceWidth] of faceWidthsMm.entries()) {
    const curved = curvedFaces.has(faceIndex + 1);
    for (const panelWidth of splitRun(faceWidth, maxPanelWidthMm)) {
      for (const courseLength of courseLengthsMm) {
        panelsPerColumn += 1;
        // A curved panel is a different product from a flat one of the same
        // size, so it is a different group even when the millimetres match.
        const key = `${String(panelWidth)}x${String(courseLength)}x${curved ? "C" : "F"}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.countPerColumn += 1;
          existing.totalCount += quantity;
          continue;
        }
        grouped.set(key, {
          widthMm: panelWidth,
          lengthMm: courseLength,
          countPerColumn: 1,
          totalCount: quantity,
          fullPanel:
            panelWidth === maxPanelWidthMm && courseLength === maxPanelLengthMm,
          curved,
        });
      }
    }
  }

  return {
    faceWidthsMm,
    totalFaceWidthMm: faceWidthsMm.reduce((sum, width) => sum + width, 0),
    facesPerColumn: faceWidthsMm.length,
    totalFaces: faceWidthsMm.length * quantity,
    verticalCourses: courseLengthsMm.length,
    courseLengthsMm,
    panelsPerColumn,
    totalPanels: panelsPerColumn * quantity,
    panels: [...grouped.values()].sort(
      (a, b) => b.widthMm * b.lengthMm - a.widthMm * a.lengthMm,
    ),
    curvedFaceCount: faceWidthsMm.filter((_face, index) =>
      curvedFaces.has(index + 1),
    ).length,
    notes,
  };
}
