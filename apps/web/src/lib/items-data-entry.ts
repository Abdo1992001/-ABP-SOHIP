import { parseBoardDimensions } from "./cargo-bundling.ts";
import {
  boardPriceFromPerKg,
  referenceBoardWeightKg,
  WORKBOOK,
} from "./workbook-defaults.ts";

/**
 * The items data-entry grid: one row per board size, priced both ways.
 *
 * This is the shape the engineering studio has always been entered in —
 * type, thickness, width, length, quantity — with the two columns that were
 * missing: the density the weight is derived from, and the catalogue item the
 * row stands for.
 *
 * The two new columns are what make the row fill itself, and they work in
 * both directions:
 *
 *   item chosen  → thickness, width, length come from the item
 *   dimensions typed → weight, then unit price, come from density and rate
 *
 * Picking the item has to read its description rather than its columns. The
 * product master holds `thickness_mm`, `width_mm`, `length_mm`, `weight_kg`
 * and `density_kg_m3`, and **every one of those is null on all 2,927
 * products** — the dimensions live inside the canonical description
 * (`Acrow Board 12 mm × 585 mm × 885 mm ( M Board )`), where 2,735 of them
 * parse cleanly. Reading the columns would have filled nothing and looked
 * broken.
 */

export type ItemRowType = "" | "LINEAR" | "CIRCULAR";

export interface ItemRow {
  /** Stable across reorder and delete, so React keys never collide. */
  key: string;
  type: ItemRowType;
  /** Catalogue item this row stands for, when one was chosen. */
  productId: string;
  productLabel: string;
  thicknessMm: string;
  widthMm: string;
  lengthMm: string;
  densityKgM3: string;
  qty: string;
}

/**
 * A new row, pre-filled the way the sheet pre-fills it: 18 mm boards at the
 * standard 2440 width, at the workbook's density. A blank grid that makes a
 * person type 18 and 2440 on every row is a grid that gets them wrong.
 */
export function blankItemRow(key: string): ItemRow {
  return {
    key,
    type: "",
    productId: "",
    productLabel: "",
    thicknessMm: String(WORKBOOK.thicknessMm),
    widthMm: String(WORKBOOK.standardBoardLengthMm),
    lengthMm: "",
    densityKgM3: String(WORKBOOK.densityKgM3),
    qty: "",
  };
}

export interface CatalogueItem {
  productId: string;
  label: string;
  /** The canonical description the dimensions are read out of. */
  description: string;
}

/**
 * Fill a row from the catalogue item chosen on it.
 *
 * Only the dimensions the item actually states are written. An item whose
 * description carries no dimensions leaves what the person typed alone rather
 * than blanking it, because clearing someone's input to signal "I found
 * nothing" is the worst of both.
 */
export function applyCatalogueItem(row: ItemRow, item: CatalogueItem): ItemRow {
  const parsed = parseBoardDimensions(item.description);
  const next: ItemRow = {
    ...row,
    productId: item.productId,
    // The line takes the item's own name; the label may carry its code too.
    productLabel: item.description,
  };
  if (parsed === null) return next;
  return {
    ...next,
    thicknessMm: String(parsed.thicknessMm),
    widthMm: String(parsed.widthMm),
    lengthMm: String(parsed.lengthMm),
  };
}

export interface RowFigures {
  /** Weight of one piece, kg. */
  weightKgPerPiece: number;
  totalWeightKg: number;
  unitPrice: number;
  lineTotal: number;
  /** True once the row has everything it needs to price. */
  complete: boolean;
}

/**
 * The figures a row implies: dimensions and density give the weight, the rate
 * gives the price. This is the same chain the workbook prints — it is not a
 * second pricing rule, it is the one rule applied to a row.
 */
export function rowFigures(row: ItemRow, pricePerKg: number): RowFigures {
  const thickness = Number(row.thicknessMm);
  const width = Number(row.widthMm);
  const length = Number(row.lengthMm);
  const density = Number(row.densityKgM3);
  const qty = Number(row.qty);
  const usable =
    [thickness, width, length, density].every(
      (value) => Number.isFinite(value) && value > 0,
    ) && Number.isFinite(qty);

  if (!usable)
    return {
      weightKgPerPiece: 0,
      totalWeightKg: 0,
      unitPrice: 0,
      lineTotal: 0,
      complete: false,
    };

  const weightKgPerPiece = referenceBoardWeightKg(
    width,
    length,
    thickness,
    density,
  );
  const unitPrice = boardPriceFromPerKg(pricePerKg, weightKgPerPiece);
  const pieces = qty > 0 ? qty : 0;
  return {
    weightKgPerPiece,
    totalWeightKg: weightKgPerPiece * pieces,
    unitPrice,
    lineTotal: unitPrice * pieces,
    complete: pieces > 0,
  };
}

/**
 * The other direction: a price somebody typed for one piece, turned back into
 * the rate per kg it implies. Entering either and seeing the other is what
 * the workbook does, and a grid that only went one way would force a person
 * to do this division on paper.
 */
export function impliedPricePerKg(
  row: ItemRow,
  unitPrice: number,
): number | null {
  const figures = rowFigures(row, 0);
  if (figures.weightKgPerPiece <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return unitPrice / figures.weightKgPerPiece;
}

/** Totals across the grid, for the strip above it. */
export function gridTotals(rows: readonly ItemRow[], pricePerKg: number) {
  return rows.reduce(
    (sum, row) => {
      const figures = rowFigures(row, pricePerKg);
      return {
        pieces: sum.pieces + (Number(row.qty) || 0),
        weightKg: sum.weightKg + figures.totalWeightKg,
        amount: sum.amount + figures.lineTotal,
        priced: sum.priced + (figures.complete ? 1 : 0),
      };
    },
    { pieces: 0, weightKg: 0, amount: 0, priced: 0 },
  );
}
