/**
 * Boards become bundles before they become cargo.
 *
 * A quotation sells panels — "ACROW Board 14.5mm x 882 mm x 1482 mm", 16.1kg
 * each, 750 of them. Nothing ships one panel at a time: panels of the same
 * size are stacked and banded, and it is the *bundle* that a forklift moves
 * and a container holds. So the loader's first job is arithmetic nobody should
 * be doing on paper: how many boards go in a bundle, and how many bundles that
 * makes.
 *
 * Two limits decide it, and both are settings rather than constants, because
 * they are the factory's call and not this code's:
 *
 *   - **height**, so the band holds and the stack can be handled;
 *   - **weight**, so the forklift can lift it.
 *
 * Whichever limit bites first wins. The remainder becomes a short bundle
 * rather than being rounded away — 750 boards at 40 per bundle is 18 full
 * bundles and one of 30, and the one of 30 still has to go on the ship.
 *
 * Gross weight carries a packing allowance over the net: the proformas show
 * total weight running about 10% above net for the bearers, banding and
 * wrapping, and a container booked on net weight is a container that fails at
 * the weighbridge.
 */

export interface BundlingSettings {
  /** Tallest a banded stack may be, in millimetres. */
  readonly maxBundleHeightMm: number;
  /** Heaviest a banded stack may be, in kilograms, gross. */
  readonly maxBundleWeightKg: number;
  /** Packing over net weight, as a fraction: 0.1 is the observed 10%. */
  readonly packingAllowance: number;
  /** Bearers and banding under and around the stack, in millimetres. */
  readonly bundleBaseHeightMm: number;
}

export const DEFAULT_BUNDLING: BundlingSettings = {
  maxBundleHeightMm: 1100,
  maxBundleWeightKg: 1500,
  packingAllowance: 0.1,
  bundleBaseHeightMm: 100,
};

/** One board size, as a quotation or a proforma states it. */
export interface BoardLine {
  readonly id: string;
  readonly description: string;
  readonly thicknessMm: number;
  readonly widthMm: number;
  readonly lengthMm: number;
  /**
   * What the board is made of, in kilograms per cubic metre.
   *
   * The weight follows from this and the three dimensions, the way the
   * workbook derives it. A weight typed by hand goes stale the moment a
   * dimension changes, and a cargo plan on a stale weight books a container
   * that fails at the weighbridge.
   */
  readonly densityKgM3: number;
  /**
   * Net weight of a single board, in kilograms.
   *
   * Zero means "work it out from the density". A positive value is a weight
   * that arrived from outside — a customer's sheet, a supplier's datasheet —
   * and is used exactly as given, because that is the figure the shipment is
   * weighed against.
   */
  readonly unitWeightKg: number;
  readonly quantity: number;
}

export interface BundleGroup {
  readonly itemId: string;
  readonly description: string;
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly thicknessMm: number;
  readonly unitWeightKg: number;
  readonly boardsTotal: number;
  /** Boards in a full bundle. */
  readonly boardsPerBundle: number;
  /** Full bundles, not counting the remainder. */
  readonly fullBundles: number;
  /** Boards left over, forming one short bundle. 0 when it divides evenly. */
  readonly remainderBoards: number;
  /** Full bundles plus the short one, if there is one. */
  readonly bundleCount: number;
  readonly fullBundleHeightMm: number;
  readonly fullBundleWeightKg: number;
  /** Which limit set `boardsPerBundle`. */
  readonly limitedBy: "HEIGHT" | "WEIGHT";
}

/** How many boards fit in one bundle, and which limit decided it. */
export function boardsPerBundle(
  line: Pick<BoardLine, "thicknessMm" | "unitWeightKg">,
  settings: BundlingSettings,
): { count: number; limitedBy: "HEIGHT" | "WEIGHT" } {
  const usableHeight = Math.max(
    0,
    settings.maxBundleHeightMm - settings.bundleBaseHeightMm,
  );
  const byHeight =
    line.thicknessMm > 0 ? Math.floor(usableHeight / line.thicknessMm) : 0;
  const grossPerBoard = line.unitWeightKg * (1 + settings.packingAllowance);
  const byWeight =
    grossPerBoard > 0
      ? Math.floor(settings.maxBundleWeightKg / grossPerBoard)
      : 0;
  // At least one board, or a heavy panel would produce a bundle of nothing and
  // silently drop the line.
  const count = Math.max(1, Math.min(byHeight, byWeight));
  return { count, limitedBy: byWeight <= byHeight ? "WEIGHT" : "HEIGHT" };
}

/** Split one board line into bundles. */
export function bundleLine(
  line: BoardLine,
  settings: BundlingSettings = DEFAULT_BUNDLING,
): BundleGroup {
  const { count, limitedBy } = boardsPerBundle(line, settings);
  const total = Math.max(0, Math.floor(line.quantity));
  const fullBundles = Math.floor(total / count);
  const remainderBoards = total - fullBundles * count;
  return {
    itemId: line.id,
    description: line.description,
    widthMm: line.widthMm,
    lengthMm: line.lengthMm,
    thicknessMm: line.thicknessMm,
    unitWeightKg: line.unitWeightKg,
    boardsTotal: total,
    boardsPerBundle: count,
    fullBundles,
    remainderBoards,
    bundleCount: fullBundles + (remainderBoards > 0 ? 1 : 0),
    fullBundleHeightMm: bundleHeightMm(count, line.thicknessMm, settings),
    fullBundleWeightKg: bundleWeightKg(count, line.unitWeightKg, settings),
    limitedBy,
  };
}

export function bundleHeightMm(
  boards: number,
  thicknessMm: number,
  settings: BundlingSettings,
): number {
  return (
    Math.round((boards * thicknessMm + settings.bundleBaseHeightMm) * 10) / 10
  );
}

export function bundleWeightKg(
  boards: number,
  unitWeightKg: number,
  settings: BundlingSettings,
): number {
  return (
    Math.round(boards * unitWeightKg * (1 + settings.packingAllowance) * 100) /
    100
  );
}

/**
 * Read a board's dimensions out of the way ACROW writes them.
 *
 * Every proforma in the archive states the size in the description —
 * "ACROW Board 14.5mm x 882 mm x 1482 mm (M- Board)" — in thickness, width,
 * length order, sometimes with a comma for the decimal point and sometimes
 * with the millimetre mark against the digits. Reading it is what lets a
 * quotation line become cargo without anyone re-typing three numbers.
 *
 * It returns null rather than guessing when the text does not carry a size:
 * an invented dimension is worse than an obvious blank.
 */
export function parseBoardDimensions(description: string): {
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
} | null {
  // Decimal commas are Polish/Arabic invoice style; normalise before matching,
  // but only between digits, so a list separator is left alone.
  const text = description.replace(/(\d),(\d)/g, "$1.$2");
  const match =
    /(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i.exec(
      text,
    );
  if (match === null) return null;
  const [, a, b, c] = match;
  const thicknessMm = Number(a);
  const widthMm = Number(b);
  const lengthMm = Number(c);
  if (
    !Number.isFinite(thicknessMm) ||
    !Number.isFinite(widthMm) ||
    !Number.isFinite(lengthMm)
  )
    return null;
  return { thicknessMm, widthMm, lengthMm };
}
