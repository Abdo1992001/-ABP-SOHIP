import {
  boardDescriptor,
  type BoardDescriptorClass,
} from "./board-descriptor.ts";
import type { BoardLine } from "./cargo-bundling.ts";

/**
 * A quotation line becomes as many boards as it actually delivers.
 *
 * A column or a circular column is one line on the quotation and several
 * different panels in the container. The quotation names the first and appends
 * "(+3 sizes)", which is right on a document a customer reads — they are buying
 * one column — and wrong everywhere here.
 *
 * It was wrong in two ways at once, and the second is the one that matters:
 *
 *   * the plan drew one colour for what are three different products, so the
 *     picture told the crew that a stack was all one thing; and
 *   * it packed every piece at the *first* panel's size, because that is the
 *     only size the line carries. A 620 x 2000 panel and a 1220 x 2440 panel do
 *     not occupy the same space, so the container count came out of arithmetic
 *     on boards that were never going to be loaded.
 *
 * The schedule is already in the line's own price snapshot — the server writes
 * every panel and every piece with its own dimensions and count — so nothing
 * here is inferred. Each cut size becomes its own board, with its own name, its
 * own quantity and its own colour, and two panels of the same size inside one
 * line are added together rather than listed twice.
 *
 * The weight is left to the density. `calculatedWeightKg` on the line is the
 * weight the *line* was priced on; applying it to a panel of a different size
 * would be the same mistake in the other direction.
 */

export interface QuotationLineLike {
  readonly quotationLineId?: unknown;
  readonly description?: unknown;
  readonly sectionLabel?: unknown;
  readonly qty?: unknown;
  readonly priceSnapshot?: unknown;
  readonly [field: string]: unknown;
}

/** One delivered size, as the price snapshot records it. */
interface CutSize {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly count: number;
}

function numberOf(value: unknown, fallback = 0): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Same size twice in one line is one entry with the counts added. */
function merge(sizes: readonly CutSize[]): CutSize[] {
  const byShape = new Map<string, CutSize>();
  for (const size of sizes) {
    if (size.widthMm <= 0 || size.lengthMm <= 0 || size.count <= 0) continue;
    const key = `${String(Math.round(size.widthMm))}x${String(Math.round(size.lengthMm))}`;
    const held = byShape.get(key);
    byShape.set(
      key,
      held === undefined ? size : { ...held, count: held.count + size.count },
    );
  }
  return [...byShape.values()];
}

/** The cut sizes a line delivers, or none when it delivers exactly one board. */
export function cutSizesOf(line: QuotationLineLike): CutSize[] {
  const snapshot = isRecord(line.priceSnapshot) ? line.priceSnapshot : {};

  const column = isRecord(snapshot.column) ? snapshot.column : null;
  if (column !== null && Array.isArray(column.panels))
    return merge(
      column.panels.filter(isRecord).map((panel) => ({
        widthMm: numberOf(panel.widthMm),
        lengthMm: numberOf(panel.lengthMm),
        count: Math.round(numberOf(panel.totalCount)),
      })),
    );

  const circular = isRecord(snapshot.circular) ? snapshot.circular : null;
  if (circular !== null && Array.isArray(circular.pieces))
    return merge(
      circular.pieces.filter(isRecord).map((piece) => ({
        widthMm: numberOf(piece.widthMm),
        // A circular piece is described by its arc width and its course
        // height; the height is the length that lies along the container.
        lengthMm: numberOf(piece.heightMm),
        count: Math.round(numberOf(piece.totalCount)),
      })),
    );

  return [];
}

/**
 * Every board a quotation line puts in the container.
 *
 * `single` builds the one-board case — the caller already knows how to read a
 * plain line, and that reading is not repeated here.
 */
export function boardsFromLine(
  line: QuotationLineLike,
  index: number,
  single: (line: QuotationLineLike, index: number) => BoardLine,
): BoardLine[] {
  const base = single(line, index);
  const sizes = cutSizesOf(line);
  // One size, or none recorded: the line is already the board.
  if (sizes.length <= 1) return [base];

  const snapshot = isRecord(line.priceSnapshot) ? line.priceSnapshot : {};
  const materialClass = (
    typeof snapshot.materialClass === "string"
      ? snapshot.materialClass
      : "STANDARD"
  ) as BoardDescriptorClass;
  const circular = isRecord(snapshot.circular) ? snapshot.circular : null;
  const diameterMm = circular === null ? 0 : numberOf(circular.diameterMm);

  return sizes.map((size, position) => ({
    ...base,
    id: `${base.id}#${String(position + 1)}`,
    // Named in full, by itself. Naming one size and counting the rest is what
    // the document does, and a container is not a document.
    description: boardDescriptor({
      materialClass,
      thicknessMm: base.thicknessMm,
      widthMm: size.widthMm,
      lengthMm: size.lengthMm,
      ...(diameterMm > 0 ? { diameterMm } : {}),
    }),
    widthMm: size.widthMm,
    lengthMm: size.lengthMm,
    quantity: size.count,
    // Derived from this panel's own volume, not inherited from the line.
    unitWeightKg: 0,
  }));
}
