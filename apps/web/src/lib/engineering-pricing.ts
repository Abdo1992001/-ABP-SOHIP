/**
 * Client-side mirror of apps/api/src/quotation/engineering-pricing.ts, used
 * only for a live preview while editing a quotation line — the server always
 * recomputes authoritatively on save. Keep both in sync when the formulas
 * change; they both port ABP Engineering Studio's equation-registry.js
 * (linear_price / circular_price).
 */

export type EngineeringPricingMethod = "LINEAR" | "WEIGHT_BASED";

export interface EngineeringPricingInputs {
  lengthMm: number;
  widthMm: number;
  thicknessMm?: number;
  densityKgM3?: number;
  pricePerKg?: number;
}

const LINEAR_BOARD_WIDTH_M = 1.22;
const LINEAR_BOARD_LENGTH_M = 2.44;
const PRICE_ROUNDING_STEP = 0.05;

// Mirrors apps/api/src/quotation/engineering-pricing.ts's roundToNearestStep.
function roundToNearestStep(value: number): number {
  return Math.round(value / PRICE_ROUNDING_STEP) * PRICE_ROUNDING_STEP;
}

export function previewEngineeringUnitPrice(
  method: EngineeringPricingMethod,
  inputs: EngineeringPricingInputs,
  standardBoardPrice: number,
): number {
  const lengthM = inputs.lengthMm / 1000;
  const widthM = inputs.widthMm / 1000;

  if (method === "LINEAR") {
    const price1MLinear =
      standardBoardPrice / (LINEAR_BOARD_WIDTH_M * LINEAR_BOARD_LENGTH_M);
    return roundToNearestStep(lengthM * widthM * price1MLinear);
  }

  const thicknessMm = inputs.thicknessMm ?? 0;
  const densityKgM3 = inputs.densityKgM3 ?? 0;
  const pricePerKg = inputs.pricePerKg ?? 0;
  return roundToNearestStep(
    computeWeightKg({
      lengthMm: inputs.lengthMm,
      widthMm: inputs.widthMm,
      thicknessMm,
      densityKgM3,
    }) * pricePerKg,
  );
}

/**
 * weight_kg = (width/1000) * (length/1000) * (thickness/1000) * density,
 * matching apps/api/src/quotation/engineering-pricing.ts's computeWeightKg.
 * Real density in kg/m3 (company default 720).
 */
export function computeWeightKg(inputs: {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  densityKgM3: number;
}): number {
  return (
    (inputs.lengthMm / 1000) *
    (inputs.widthMm / 1000) *
    (inputs.thicknessMm / 1000) *
    inputs.densityKgM3
  );
}

export interface ReferenceBoard {
  referenceBoardWidthMm: number;
  referenceBoardLengthMm: number;
  thicknessMm: number;
  densityKgM3: number;
}

/**
 * Bidirectional standard price/kg <-> full board price conversion, mirroring
 * apps/api/src/quotation/engineering-pricing.ts's deriveStandardRate (and the
 * ACROW BOARD sheet's SETTINGS!B18/B19 formula pair). boardWeightKg uses the
 * reference board footprint (default 1220x2440x18mm @ 720 kg/m3).
 */
export function deriveStandardRate(
  input:
    | {
        mode: "PRICE_PER_KG";
        pricePerKg: number;
        referenceBoard: ReferenceBoard;
      }
    | {
        mode: "BOARD_PRICE";
        boardPrice: number;
        referenceBoard: ReferenceBoard;
      },
): { pricePerKg: number; boardPrice: number; boardWeightKg: number } {
  const boardWeightKg = computeWeightKg({
    lengthMm: input.referenceBoard.referenceBoardLengthMm,
    widthMm: input.referenceBoard.referenceBoardWidthMm,
    thicknessMm: input.referenceBoard.thicknessMm,
    densityKgM3: input.referenceBoard.densityKgM3,
  });
  if (input.mode === "PRICE_PER_KG") {
    return {
      pricePerKg: input.pricePerKg,
      boardPrice: boardWeightKg * input.pricePerKg,
      boardWeightKg,
    };
  }
  return {
    pricePerKg: boardWeightKg > 0 ? input.boardPrice / boardWeightKg : 0,
    boardPrice: input.boardPrice,
    boardWeightKg,
  };
}
