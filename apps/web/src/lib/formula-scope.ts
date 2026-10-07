/**
 * Client-side mirror of apps/api/src/quotation/formula-scope.ts — the
 * variables a quotation line offers a custom formula, in the units a price is
 * actually quoted in.
 */

export interface LineFormulaInputs {
  widthMm?: number | null;
  lengthMm?: number | null;
  heightMm?: number | null;
  thicknessMm?: number | null;
  diameterMm?: number | null;
  radiusMm?: number | null;
  densityKgM3?: number | null;
  quantity?: number | null;
  /** The rate the pricing hierarchy resolved for this line. */
  rate?: number | null;
  fabricationCost?: number | null;
  fixedCost?: number | null;
  wastePercent?: number | null;
}

const value = (input: number | null | undefined): number =>
  typeof input === "number" && Number.isFinite(input) ? input : 0;

export function buildLineFormulaScope(
  inputs: LineFormulaInputs,
): Record<string, number> {
  const widthMm = value(inputs.widthMm);
  const lengthMm = value(inputs.lengthMm);
  const heightMm = value(inputs.heightMm);
  const thicknessMm = value(inputs.thicknessMm);
  const diameterMm = inputs.diameterMm ?? value(inputs.radiusMm) * 2;
  const radiusMm = inputs.radiusMm ?? diameterMm / 2;
  const density = value(inputs.densityKgM3);

  const widthM = widthMm / 1000;
  const lengthM = lengthMm / 1000;
  const heightM = heightMm / 1000;
  const thicknessM = thicknessMm / 1000;
  const area = widthM * lengthM;
  const volume = area * thicknessM;
  const weight = volume * density;
  const perimeter = (diameterMm / 1000) * Math.PI;

  const scope: Record<string, number> = {
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

export const FORMULA_VARIABLE_NAMES = Object.keys(
  buildLineFormulaScope({}),
).sort();
