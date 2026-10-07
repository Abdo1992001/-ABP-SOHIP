import type { GeneratedPiece } from "./quotation-consolidation.ts";

/**
 * What the quotation supplies, in the units the business actually uses.
 *
 * A salesperson answering "how many square metres is this?" or "how many
 * tonnes am I shipping?" had to take the quotation to a calculator, because
 * the screen showed money and piece counts and nothing in between. Both
 * numbers are already implied by every generated board; they were simply
 * never added up.
 *
 * Split by family as well as in total, because the three carry different
 * rates and a reader comparing a quotation to a target needs to see which
 * part of it is curved work.
 *
 * Full precision throughout — the rounding belongs at the point of display.
 */

export type BoardFamily = "STANDARD" | "CURVED" | "CIRCULAR";

export interface FamilyTotals {
  pieces: number;
  areaM2: number;
  weightKg: number;
}

export interface TechnicalSummary {
  /** Scopes entered: a column is one element however many boards it makes. */
  elements: number;
  /** Boards actually supplied. */
  finishedPieces: number;
  totalAreaM2: number;
  totalWeightKg: number;
  /** Only the families this quotation actually contains. */
  byFamily: { family: BoardFamily; totals: FamilyTotals }[];
}

function familyOf(materialClass: GeneratedPiece["materialClass"]): BoardFamily {
  if (materialClass === "CIRCULAR") return "CIRCULAR";
  if (materialClass === "CURVED") return "CURVED";
  return "STANDARD";
}

/** One board's face area, m². */
export function pieceAreaM2(
  piece: Pick<GeneratedPiece, "widthMm" | "lengthMm">,
): number {
  return (piece.widthMm / 1000) * (piece.lengthMm / 1000);
}

/** One board's weight, kg. */
export function pieceWeightKg(
  piece: Pick<
    GeneratedPiece,
    "widthMm" | "lengthMm" | "thicknessMm" | "densityKgM3"
  >,
): number {
  return pieceAreaM2(piece) * (piece.thicknessMm / 1000) * piece.densityKgM3;
}

export function technicalSummary(
  pieces: readonly GeneratedPiece[],
  elementCount: number,
): TechnicalSummary {
  const families = new Map<BoardFamily, FamilyTotals>();
  let finishedPieces = 0;
  let totalAreaM2 = 0;
  let totalWeightKg = 0;

  for (const piece of pieces) {
    if (!(piece.qty > 0)) continue;
    const area = pieceAreaM2(piece) * piece.qty;
    const weight = pieceWeightKg(piece) * piece.qty;
    finishedPieces += piece.qty;
    totalAreaM2 += area;
    totalWeightKg += weight;

    const family = familyOf(piece.materialClass);
    const current = families.get(family) ?? {
      pieces: 0,
      areaM2: 0,
      weightKg: 0,
    };
    families.set(family, {
      pieces: current.pieces + piece.qty,
      areaM2: current.areaM2 + area,
      weightKg: current.weightKg + weight,
    });
  }

  // A fixed order so the same quotation reads the same way twice, and only
  // the families that are actually on it.
  const order: BoardFamily[] = ["STANDARD", "CURVED", "CIRCULAR"];
  return {
    elements: elementCount,
    finishedPieces,
    totalAreaM2,
    totalWeightKg,
    byFamily: order
      .filter((family) => families.has(family))
      .map((family) => ({
        family,
        totals: families.get(family) ?? { pieces: 0, areaM2: 0, weightKg: 0 },
      })),
  };
}

/**
 * The reference board, stated every way a quotation is argued in.
 *
 * The screen showed the price per kilogram and the price per board. A
 * customer comparing suppliers asks for the price per square metre, and that
 * conversion was being done by hand.
 */
export interface ReferenceBasis {
  areaM2: number;
  weightKg: number;
  boardPrice: number;
  pricePerKg: number;
  pricePerM2: number;
}

export function referenceBasis(input: {
  widthMm: number;
  lengthMm: number;
  thicknessMm: number;
  densityKgM3: number;
  boardPrice: number;
}): ReferenceBasis {
  const areaM2 = (input.widthMm / 1000) * (input.lengthMm / 1000);
  const weightKg = areaM2 * (input.thicknessMm / 1000) * input.densityKgM3;
  return {
    areaM2,
    weightKg,
    boardPrice: input.boardPrice,
    pricePerKg: weightKg > 0 ? input.boardPrice / weightKg : 0,
    pricePerM2: areaM2 > 0 ? input.boardPrice / areaM2 : 0,
  };
}
