/**
 * The sizes of one quotation line, typed where the line is.
 *
 * The dimensions used to live only in the line's side panel. Choosing a type
 * quietly filled in a 1220 x 2440 sheet, the row showed a price for it, and
 * nothing on the row said what size it was pricing -- so a salesperson who
 * wanted a 620 x 2000 panel had to find a gear icon to say so. The sheet the
 * company quoted from before had the sizes in the row, beside the type, and
 * that is where people look for them.
 *
 * What is typed depends on what the line is, because a column is not a sheet:
 *
 *   - a flat or curved board is thickness x width x length;
 *   - a rectangular column is its two sides and its height -- the panels are
 *     cut from those, so asking for a board width would be asking the wrong
 *     question;
 *   - a circular column is its diameter and its height;
 *   - a core or a wall is a list of faces, which does not fit in a row, so the
 *     row carries the height and a button to the face list.
 *
 * The side panel stays for everything that is not a size: rate overrides,
 * density, mould segments, notes.
 */

import type { ReactNode } from "react";

export type DimensionClass =
  "" | "STANDARD" | "REGULAR" | "CURVED" | "CIRCULAR" | "CORE" | "WALL";

export interface DimensionLine {
  readonly materialClass: DimensionClass;
  readonly columnShape?: string;
  readonly thicknessMm: string;
  readonly widthMm: string;
  readonly lengthMm: string;
  readonly sideAMm: string;
  readonly sideBMm: string;
  readonly columnHeightMm: string;
  readonly diameterMm: string;
  readonly faceWidthsMm: readonly string[];
}

export type DimensionField =
  | "thicknessMm"
  | "widthMm"
  | "lengthMm"
  | "sideAMm"
  | "sideBMm"
  | "columnHeightMm"
  | "diameterMm";

interface FieldSpec {
  readonly field: DimensionField;
  /** The one or two characters printed above the box. */
  readonly short: string;
  /** What a screen reader says, and the tooltip. */
  readonly en: string;
  readonly ar: string;
}

const T: FieldSpec = {
  field: "thicknessMm",
  short: "T",
  en: "Thickness (mm)",
  ar: "السُمك (مم)",
};
const W: FieldSpec = {
  field: "widthMm",
  short: "W",
  en: "Width (mm)",
  ar: "العرض (مم)",
};
const L: FieldSpec = {
  field: "lengthMm",
  short: "L",
  en: "Length (mm)",
  ar: "الطول (مم)",
};
const A: FieldSpec = {
  field: "sideAMm",
  short: "A",
  en: "Side A (mm)",
  ar: "الضلع A (مم)",
};
const B: FieldSpec = {
  field: "sideBMm",
  short: "B",
  en: "Side B (mm)",
  ar: "الضلع B (مم)",
};
const H: FieldSpec = {
  field: "columnHeightMm",
  short: "H",
  en: "Column height (mm)",
  ar: "ارتفاع العمود (مم)",
};
const D: FieldSpec = {
  field: "diameterMm",
  short: "Ø",
  en: "Diameter (mm)",
  ar: "القطر (مم)",
};

/** A line whose sizes are a list of faces rather than a fixed set of boxes. */
export function usesFaces(line: DimensionLine): boolean {
  return (
    line.materialClass === "CORE" ||
    line.materialClass === "WALL" ||
    (line.materialClass === "REGULAR" && line.columnShape === "IRREGULAR")
  );
}

/** Which boxes a line of this type is sized by, in the order they are read. */
export function dimensionFields(line: DimensionLine): readonly FieldSpec[] {
  switch (line.materialClass) {
    case "STANDARD":
    case "CURVED":
      return [T, W, L];
    case "REGULAR":
      return usesFaces(line) ? [T, H] : [T, A, B, H];
    case "CIRCULAR":
      return [T, D, H];
    case "CORE":
    case "WALL":
      return [T, H];
    default:
      return [];
  }
}

/**
 * Whether the line has enough size to be priced.
 *
 * Used to mark the row rather than to block it: a half-typed row is normal
 * while someone is typing, and the status chip already says "check input".
 */
export function dimensionsComplete(line: DimensionLine): boolean {
  const fields = dimensionFields(line);
  if (fields.length === 0) return false;
  const filled = fields.every((spec) => {
    // A column's height falls back to the company default, so it is never
    // what makes a row incomplete.
    if (spec.field === "columnHeightMm") return true;
    const value = Number(line[spec.field]);
    return Number.isFinite(value) && value > 0;
  });
  if (!filled) return false;
  if (usesFaces(line))
    return line.faceWidthsMm.some((face) => Number(face) > 0);
  return true;
}

export function LineDimensions({
  line,
  index,
  editable,
  locale,
  placeholders,
  onChange,
  onFaces,
}: {
  line: DimensionLine;
  index: number;
  editable: boolean;
  locale: "en" | "ar";
  /** What an empty box shows: the company's default height, for instance. */
  placeholders?: Partial<Record<DimensionField, string>>;
  onChange: (field: DimensionField, value: string) => void;
  /** Opens the face list for a core, a wall or an irregular column. */
  onFaces: () => void;
}): ReactNode {
  const fields = dimensionFields(line);
  const ar = locale === "ar";

  if (fields.length === 0)
    return (
      <span className="line-dims-empty">
        {ar ? "اختار النوع الأول" : "Choose a type first"}
      </span>
    );

  const faceCount = line.faceWidthsMm.filter((face) => Number(face) > 0).length;

  return (
    <div className="line-dims" dir="ltr">
      {fields.map((spec) => (
        <label
          key={spec.field}
          className="line-dim"
          title={ar ? spec.ar : spec.en}
        >
          <span aria-hidden="true">{spec.short}</span>
          <input
            aria-label={`${ar ? spec.ar : spec.en} ${String(index + 1)}`}
            inputMode="decimal"
            readOnly={!editable}
            value={line[spec.field]}
            placeholder={placeholders?.[spec.field] ?? ""}
            onChange={(event) => {
              onChange(spec.field, event.target.value);
            }}
          />
        </label>
      ))}
      {usesFaces(line) && (
        <button
          type="button"
          className={`line-dims-faces ${faceCount === 0 ? "is-empty" : ""}`}
          onClick={onFaces}
        >
          {faceCount === 0
            ? ar
              ? "الأوجه…"
              : "Faces…"
            : ar
              ? `${String(faceCount)} وجه`
              : `${String(faceCount)} faces`}
        </button>
      )}
    </div>
  );
}
