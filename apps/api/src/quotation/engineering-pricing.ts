import { Prisma } from "@abp/database";

/**
 * Ports the engineering pricing formulas from ABP Engineering Studio
 * (src/registries/equation-registry.js: linear_price, circular_price) so the
 * web CRM's Quotation Studio can compute a unit price from dimensions
 * instead of requiring a manually typed price. Pure function, no DB access —
 * callers resolve PricingBaseConfig and pass its values in.
 */

export type EngineeringPricingMethod = "LINEAR" | "WEIGHT_BASED";

export interface EngineeringPricingInputs {
  lengthMm: Prisma.Decimal;
  widthMm: Prisma.Decimal;
  thicknessMm?: Prisma.Decimal | undefined;
  densityKgM3?: Prisma.Decimal | undefined;
  pricePerKg?: Prisma.Decimal | undefined;
}

export interface EngineeringBaseConfig {
  standardBoardPrice: Prisma.Decimal;
}

export interface EngineeringPricingResult {
  unitPrice: Prisma.Decimal;
  breakdown: Record<string, string>;
}

// Fixed Linear board footprint (1.22m x 2.44m), matching Engineering Studio's
// price1MLinear derivation (priceAcrowBoard / (1.22 * 2.44)).
const LINEAR_BOARD_WIDTH_M = new Prisma.Decimal("1.22");
const LINEAR_BOARD_LENGTH_M = new Prisma.Decimal("2.44");
const PRICE_ROUNDING_STEP = new Prisma.Decimal("0.05");

// Engineering Studio rounds every computed unit price to the nearest 0.05
// EGP (equation-registry.js linear_price/circular_price "steps").
function roundToNearestStep(value: Prisma.Decimal): Prisma.Decimal {
  return value
    .div(PRICE_ROUNDING_STEP)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .mul(PRICE_ROUNDING_STEP);
}

export function computeEngineeringUnitPrice(
  method: EngineeringPricingMethod,
  inputs: EngineeringPricingInputs,
  baseConfig: EngineeringBaseConfig,
): EngineeringPricingResult {
  const lengthM = inputs.lengthMm.div(1000);
  const widthM = inputs.widthMm.div(1000);

  if (method === "LINEAR") {
    const price1MLinear = baseConfig.standardBoardPrice.div(
      LINEAR_BOARD_WIDTH_M.mul(LINEAR_BOARD_LENGTH_M),
    );
    const unitPrice = roundToNearestStep(
      lengthM.mul(widthM).mul(price1MLinear),
    );
    return {
      unitPrice,
      breakdown: {
        formula: "(lengthMm/1000) * (widthMm/1000) * price1MLinear",
        price1MLinear: price1MLinear.toString(),
        standardBoardPrice: baseConfig.standardBoardPrice.toString(),
      },
    };
  }

  const thicknessMm = inputs.thicknessMm ?? new Prisma.Decimal(0);
  const densityKgM3 = inputs.densityKgM3 ?? new Prisma.Decimal(0);
  const pricePerKg = inputs.pricePerKg ?? new Prisma.Decimal(0);
  const weightKg = computeWeightKg({
    lengthMm: inputs.lengthMm,
    widthMm: inputs.widthMm,
    thicknessMm,
    densityKgM3,
  });
  const unitPrice = roundToNearestStep(weightKg.mul(pricePerKg));
  return {
    unitPrice,
    breakdown: {
      formula:
        "weightKg * pricePerKg, where weightKg = (lengthMm/1000)*(widthMm/1000)*(thicknessMm/1000)*densityKgM3",
      weightKg: weightKg.toFixed(3),
      thicknessMm: thicknessMm.toString(),
      densityKgM3: densityKgM3.toString(),
      pricePerKg: pricePerKg.toString(),
    },
  };
}

/**
 * weight_kg = (width/1000) * (length/1000) * (thickness/1000) * density,
 * per the ACROW BOARD sheet's own formula (spec §5). Real density in
 * kg/m3 (company default 720) — kept at full precision internally,
 * displayed at 3 decimals.
 */
export function computeWeightKg(inputs: {
  lengthMm: Prisma.Decimal;
  widthMm: Prisma.Decimal;
  thicknessMm: Prisma.Decimal;
  densityKgM3: Prisma.Decimal;
}): Prisma.Decimal {
  return inputs.lengthMm
    .div(1000)
    .mul(inputs.widthMm.div(1000))
    .mul(inputs.thicknessMm.div(1000))
    .mul(inputs.densityKgM3);
}

/**
 * Bidirectional STANDARD price/kg <-> full board price conversion (spec §7).
 * boardWeightKg uses the reference board footprint (default 1220x2440x18mm).
 */
export function deriveStandardRate(
  input:
    | {
        mode: "PRICE_PER_KG";
        standardPricePerKg: Prisma.Decimal;
        referenceBoard: ReferenceBoard;
      }
    | {
        mode: "BOARD_PRICE";
        standardBoardPrice: Prisma.Decimal;
        referenceBoard: ReferenceBoard;
      },
): {
  standardPricePerKg: Prisma.Decimal;
  standardBoardPrice: Prisma.Decimal;
  boardWeightKg: Prisma.Decimal;
} {
  const boardWeightKg = computeWeightKg({
    lengthMm: input.referenceBoard.referenceBoardLengthMm,
    widthMm: input.referenceBoard.referenceBoardWidthMm,
    thicknessMm: input.referenceBoard.defaultThicknessMm,
    densityKgM3: input.referenceBoard.defaultDensityKgM3,
  });
  if (input.mode === "PRICE_PER_KG") {
    return {
      standardPricePerKg: input.standardPricePerKg,
      standardBoardPrice: boardWeightKg.mul(input.standardPricePerKg),
      boardWeightKg,
    };
  }
  return {
    standardPricePerKg: boardWeightKg.greaterThan(0)
      ? input.standardBoardPrice.div(boardWeightKg)
      : new Prisma.Decimal(0),
    standardBoardPrice: input.standardBoardPrice,
    boardWeightKg,
  };
}

export interface ReferenceBoard {
  referenceBoardWidthMm: Prisma.Decimal;
  referenceBoardLengthMm: Prisma.Decimal;
  defaultThicknessMm: Prisma.Decimal;
  defaultDensityKgM3: Prisma.Decimal;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHEET'S OWN QUANTITY AND WEIGHT RULES
   ---------------------------------------------------------------------------
   Ported from ABP Engineering Studio (src/core/pricing/pricing-calculator.js),
   which is the authority every ACROW quotation has been built on. Three rules
   live there that this system did not have, and all three change money:

     noOfBoards = ceil(meterExtension / 2.44)
     qty        = isLinear ? entered * noOfBoards : entered
     Linear board weight is FIXED at 33 kg, not derived from density.

   The weight formula itself already agreed: the sheet writes
   (L/1000)*(W/1000)*thicknessMm*0.72 and this file writes
   (L/1000)*(W/1000)*(thicknessMm/1000)*720 — the same number, because 0.72
   kg per mm-metre-metre is 720 kg/m3. That one needed no change.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A Linear board's weight is a fixed 33 kg per full sheet. The sheet states it
 * as a constant rather than deriving it, because a Linear board is a stock
 * item of known weight; deriving it from density and the cut size would make
 * two boards of the same product weigh differently.
 */
export const LINEAR_BOARD_WEIGHT_KG = new Prisma.Decimal("33");

/** The standard board's own length, the module a run is divided into. */
export const BOARD_LENGTH_M = new Prisma.Decimal("2.44");

/**
 * How many boards one unit needs, from the length it has to span.
 *
 *   noOfBoards = ceil(meterExtension / 2.44)
 *
 * A 38 m extension takes 16 boards. Rounding up is not waste: the last board
 * is cut to the remainder and the offcut is used, but it is still a board that
 * has to be made.
 */
export function boardsPerUnitFromExtension(
  extensionM: Prisma.Decimal,
  boardLengthM: Prisma.Decimal = BOARD_LENGTH_M,
): number {
  if (extensionM.lessThanOrEqualTo(0) || boardLengthM.lessThanOrEqualTo(0))
    return 0;
  return Math.ceil(extensionM.div(boardLengthM).toNumber());
}

/**
 * The quantity that actually gets priced.
 *
 * Only Linear rows are multiplied by the extension board count. A curved or
 * circular row is already one complete piece — multiplying it by the Linear
 * extension is the single easiest way to quote an order at sixteen times its
 * value, and the sheet says so in as many words.
 */
export function pricedQuantity(
  method: EngineeringPricingMethod,
  enteredQty: number,
  boardsPerUnit: number,
  quantityMode: "extension" | "direct" = "extension",
): number {
  const entered = Math.max(0, Math.floor(enteredQty));
  if (method !== "LINEAR" || quantityMode === "direct") return entered;
  const boards = Math.max(0, Math.floor(boardsPerUnit));
  return boards > 0 ? entered * boards : entered;
}

/**
 * Price per kilogram implied by a Linear board's price, using the fixed board
 * weight. The sheet's `linearPricePerKg`, kept for the reciprocal display in
 * the line panel.
 */
export function linearPricePerKg(
  standardBoardPrice: Prisma.Decimal,
  boardWeightKg: Prisma.Decimal = LINEAR_BOARD_WEIGHT_KG,
): Prisma.Decimal {
  return boardWeightKg.greaterThan(0)
    ? standardBoardPrice.div(boardWeightKg)
    : new Prisma.Decimal(0);
}
