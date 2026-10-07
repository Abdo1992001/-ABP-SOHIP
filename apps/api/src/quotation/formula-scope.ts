import { Prisma } from "@abp/database";

/**
 * The variables a quotation line offers a custom formula.
 *
 * Everything here is derived from what the line already holds — a formula
 * author never has to remember that area is in square metres while the inputs
 * are in millimetres, because `area` is already in square metres by the time
 * they see it. Getting that wrong by a factor of a million is the single
 * easiest mistake to make in this system.
 *
 * Names are camelCase to match the rest of the codebase, with the spec's own
 * snake_case spellings aliased alongside, so a formula copied straight out of
 * the specification works as written.
 */

export interface LineFormulaInputs {
  widthMm?: Prisma.Decimal | null | undefined;
  lengthMm?: Prisma.Decimal | null | undefined;
  heightMm?: Prisma.Decimal | null | undefined;
  thicknessMm?: Prisma.Decimal | null | undefined;
  diameterMm?: Prisma.Decimal | null | undefined;
  radiusMm?: Prisma.Decimal | null | undefined;
  densityKgM3?: Prisma.Decimal | null | undefined;
  quantity?: Prisma.Decimal | null | undefined;
  /** The rate the pricing hierarchy resolved for this line, in currency per kg. */
  rate?: Prisma.Decimal | null | undefined;
  fabricationCost?: Prisma.Decimal | null | undefined;
  fixedCost?: Prisma.Decimal | null | undefined;
  wastePercent?: Prisma.Decimal | null | undefined;
}

const ZERO = new Prisma.Decimal(0);
const value = (input: Prisma.Decimal | null | undefined): Prisma.Decimal =>
  input ?? ZERO;

export function buildLineFormulaScope(
  inputs: LineFormulaInputs,
): Record<string, Prisma.Decimal> {
  const widthMm = value(inputs.widthMm);
  const lengthMm = value(inputs.lengthMm);
  const heightMm = value(inputs.heightMm);
  const thicknessMm = value(inputs.thicknessMm);
  const diameterMm = inputs.diameterMm ?? value(inputs.radiusMm).mul(2);
  const radiusMm = inputs.radiusMm ?? diameterMm.div(2);
  const density = value(inputs.densityKgM3);

  // Metres, square metres, cubic metres — the units a price is actually
  // quoted in.
  const widthM = widthMm.div(1000);
  const lengthM = lengthMm.div(1000);
  const heightM = heightMm.div(1000);
  const thicknessM = thicknessMm.div(1000);
  const area = widthM.mul(lengthM);
  const volume = area.mul(thicknessM);
  const weight = volume.mul(density);
  const perimeter = diameterMm.div(1000).mul("3.14159265358979323846");

  const scope: Record<string, Prisma.Decimal> = {
    width: widthMm,
    length: lengthMm,
    height: heightMm,
    thickness: thicknessMm,
    diameter: diameterMm,
    radius: radiusMm,
    widthMm,
    lengthMm,
    heightMm,
    thicknessMm,
    diameterMm,
    radiusMm,
    widthM,
    lengthM,
    heightM,
    thicknessM,
    density,
    quantity: value(inputs.quantity),
    area,
    volume,
    weight,
    perimeter,
    rate: value(inputs.rate),
    fabricationCost: value(inputs.fabricationCost),
    fixedCost: value(inputs.fixedCost),
    wastePercent: value(inputs.wastePercent),
  };

  // The specification writes these in snake_case; a formula pasted from it
  // should not fail on a naming convention.
  scope.waste_percent = value(inputs.wastePercent);
  scope.fabrication_cost = value(inputs.fabricationCost);
  scope.fixed_cost = value(inputs.fixedCost);
  scope.area_m2 = area;
  scope.volume_m3 = volume;
  scope.weight_kg = weight;
  scope.width_mm = widthMm;
  scope.length_mm = lengthMm;
  scope.height_mm = heightMm;
  scope.thickness_mm = thicknessMm;
  scope.diameter_mm = diameterMm;
  scope.radius_mm = radiusMm;

  return scope;
}

/** Every name a formula may use, for the editor's own validation. */
export const FORMULA_VARIABLE_NAMES = Object.keys(
  buildLineFormulaScope({}),
).sort();
