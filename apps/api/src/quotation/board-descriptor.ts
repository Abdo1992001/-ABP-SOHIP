/**
 * The name the customer reads.
 *
 * Every ACROW board on a quotation is described the same way, in the same
 * order, by the same rule: THICKNESS x WIDTH x LENGTH, then the family, then
 * the diameter when there is one. Typing it by hand is how two lines for the
 * same product end up reading differently on the same page, and how a curved
 * piece ends up described by its diameter instead of by what is delivered.
 *
 *   Acrow Board 18 mm x 1220 mm x 2440 mm (M Board)
 *   Acrow Board 18 mm x 1885 mm x 1200 mm (M Board Curved)
 *   Acrow Board 18 mm x 1885 mm x 1200 mm (M Board Curved) (D=1200 mm)
 *
 * The diameter is ADDED after the family; it never replaces the delivered
 * dimensions. A customer receiving 1885 x 1200 panels needs to read
 * 1885 x 1200 on the paper they signed.
 *
 * Pure, no DB and no Decimal, so apps/web runs the identical file
 * (apps/web/src/lib/board-descriptor.ts) for the live preview.
 */

export type BoardDescriptorClass =
  "STANDARD" | "REGULAR" | "CURVED" | "CIRCULAR" | "CORE" | "WALL";

export interface BoardDescriptorInput {
  materialClass: BoardDescriptorClass;
  thicknessMm: number;
  /** The delivered width. For a curve this is the developed arc, not the diameter. */
  widthMm: number;
  lengthMm: number;
  /** CIRCULAR / CURVED only: appended as (D=... mm), never substituted. */
  diameterMm?: number | null | undefined;
  /** Shown as "+N sizes" when one input item delivers more than one cut size. */
  extraSizeCount?: number | undefined;
}

/** The commercial family a class is sold as. Circular is sold as Curved. */
export function boardFamily(materialClass: BoardDescriptorClass): string {
  return materialClass === "CURVED" || materialClass === "CIRCULAR"
    ? "M Board Curved"
    : "M Board";
}

/** Whole millimetres, no separators - these are drawing dimensions. */
function mm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return String(Math.round(value));
}

export function boardDescriptor(input: BoardDescriptorInput): string {
  const dims = `${mm(input.thicknessMm)} mm \u00d7 ${mm(input.widthMm)} mm \u00d7 ${mm(input.lengthMm)} mm`;
  const parts = [
    `Acrow Board ${dims}`,
    `(${boardFamily(input.materialClass)})`,
  ];
  const diameter =
    input.materialClass === "CIRCULAR" || input.materialClass === "CURVED"
      ? input.diameterMm
      : null;
  if (typeof diameter === "number" && Number.isFinite(diameter) && diameter > 0)
    parts.push(`(D=${mm(diameter)} mm)`);
  const extra = input.extraSizeCount ?? 0;
  if (extra > 0)
    parts.push(`(+${String(extra)} size${extra === 1 ? "" : "s"})`);
  return parts.join(" ");
}

/**
 * Identity of a delivered piece for grouping (spec SS17). Two pieces belong on
 * the same quotation line when everything the customer is charged for matches:
 * the family, the three dimensions, the diameter and the applied rate. The
 * rate is part of the key because two lines priced differently are two lines,
 * however identical the steel.
 */
export function pieceGroupKey(input: {
  materialClass: BoardDescriptorClass;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  diameterMm?: number | null | undefined;
  appliedPricePerKg?: string | null | undefined;
}): string {
  return [
    boardFamily(input.materialClass),
    mm(input.thicknessMm),
    mm(input.widthMm),
    mm(input.lengthMm),
    input.diameterMm == null ? "-" : mm(input.diameterMm),
    input.appliedPricePerKg ?? "-",
  ].join("|");
}
