/**
 * What one board weighs, and where that figure came from.
 *
 * A board's weight is not a number anyone should be typing: it is width ×
 * length × thickness × density, and the workbook marks it AUTO for that reason.
 * Typed by hand it goes stale the moment a dimension changes, and a cargo plan
 * built on a stale weight books a container that fails at the weighbridge.
 *
 * But it is also a figure that arrives from outside — a customer's own
 * spreadsheet, a supplier's datasheet — and when it does, that number is the
 * one the shipment is actually weighed against. So a weight can be **stated**,
 * and a stated weight is used as given and said to be stated. What is never
 * done is silently preferring one over the other.
 */

export type WeightSource = "DERIVED" | "STATED";

export interface BoardWeight {
  readonly kg: number;
  readonly source: WeightSource;
}

/** The volume of one board in cubic metres. */
export function boardVolumeM3(
  thicknessMm: number,
  widthMm: number,
  lengthMm: number,
): number {
  return (thicknessMm / 1000) * (widthMm / 1000) * (lengthMm / 1000);
}

/**
 * The weight of one board.
 *
 * `statedKg` wins when it is a real, positive number — that is a figure
 * somebody is standing behind. Otherwise the three dimensions and the density
 * produce it, which is what the workbook does.
 */
export function boardWeightKg(board: {
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  densityKgM3: number;
  statedKg?: number | null | undefined;
}): BoardWeight {
  const stated = board.statedKg;
  if (
    stated !== null &&
    stated !== undefined &&
    Number.isFinite(stated) &&
    stated > 0
  )
    return { kg: stated, source: "STATED" };
  const kg =
    boardVolumeM3(board.thicknessMm, board.widthMm, board.lengthMm) *
    board.densityKgM3;
  return { kg: Number.isFinite(kg) && kg > 0 ? kg : 0, source: "DERIVED" };
}

/**
 * The density a stated weight implies.
 *
 * Shown beside a stated weight so an obviously wrong figure is obvious: a
 * board claiming a density of 3,000 kg/m³ is a typo, not a board. Returns null
 * when there is no volume to divide by.
 */
export function impliedDensityKgM3(board: {
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  statedKg: number;
}): number | null {
  const volume = boardVolumeM3(
    board.thicknessMm,
    board.widthMm,
    board.lengthMm,
  );
  if (volume <= 0) return null;
  const density = board.statedKg / volume;
  return Number.isFinite(density) ? density : null;
}

/**
 * Densities outside this range are not plywood.
 *
 * ACROW's own boards run around 600 kg/m³; the workbook's reference board is
 * 600. Anything under 300 or over 1,200 is a keying error — a decimal point in
 * the wrong place, or a weight entered in grams — and the screen says so
 * rather than planning a shipment around it.
 */
export function densityLooksWrong(densityKgM3: number): boolean {
  return densityKgM3 < 300 || densityKgM3 > 1200;
}
