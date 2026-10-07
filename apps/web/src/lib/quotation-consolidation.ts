import {
  boardDescriptor,
  type BoardDescriptorClass,
} from "./board-descriptor.ts";
import { parseBoardDimensions } from "./cargo-bundling.ts";
import { normalizeCode, type LookupProduct } from "./product-lookup.ts";

/**
 * Turning generated boards into the lines a customer actually reads.
 *
 * A scope does not produce one board. A rectangular column produces a panel
 * schedule — several distinct cut sizes, each with its own count — and a
 * circular column produces arc pieces the same way. Until now a scope showed
 * only its **first** size and hid the rest behind `(+3 sizes)`, so a
 * quotation could not be read as a list of what is being sold, and two scopes
 * that happened to produce the same board appeared as two unrelated lines.
 *
 * This layer sits between the two: engineering keeps its scopes and its
 * takeoff, and the commercial document gets one line per distinct product.
 *
 * Three rules do the work, and each one is a rule about *not* being clever:
 *
 *   - Items are identified by their **attributes**, never by their
 *     description text. Two descriptions that read alike are not evidence of
 *     the same product, and one that reads differently is not evidence of a
 *     different one.
 *   - Lines merge only when the **commercial context matches too** — same
 *     price, same currency, same discount. Merging two prices into one
 *     average silently changes what the customer is charged.
 *   - A product with no catalogue code gets **no code**, and says so. A
 *     generated code would look exactly like a real one for the rest of its
 *     life.
 */

export type CodeStatus = "CODED" | "CODE_PENDING" | "UNCODED";

/** One delivered board, as engineering produced it. */
export interface GeneratedPiece {
  /** Where it came from, for the engineering view. */
  sourceLabel: string;
  materialClass: BoardDescriptorClass;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  densityKgM3: number;
  diameterMm?: number | null | undefined;
  qty: number;
  /** Commercial context — part of whether two pieces may share a line. */
  unitPrice: number;
  currencyCode: string;
  discountPct?: number | undefined;
  /** Set when the row was entered by code rather than derived. */
  productId?: string | null | undefined;
  /** True when the item is deliberately outside the coded catalogue. */
  outsideCatalogue?: boolean | undefined;
}

export interface ConsolidatedLine {
  /** The canonical identity every piece on this line shares. */
  identity: string;
  itemCode: string | null;
  codeStatus: CodeStatus;
  description: string;
  /**
   * The board this line delivers, in millimetres.
   *
   * Carried on the line because the size is what finds an item code: thirty-one
   * catalogue items share 18 x 1220 x 2440, so a line whose code is still
   * pending has to be able to ask the catalogue what codes exist at its own
   * size. Reading them back out of `identity` would work until the identity
   * format changed.
   */
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  currencyCode: string;
  totalWeightKg: number;
  /** Every scope that contributed, with what it contributed. */
  sources: { label: string; qty: number }[];
}

/** Millimetres to one decimal — the precision an SKU is defined at. */
function mm(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/**
 * The canonical identity of a commercial product.
 *
 * Built from the attributes that genuinely change the SKU: the family it is
 * sold as, the three dimensions, the density, and the diameter where one
 * exists. Nothing here is free text, so two items are the same item when
 * they are physically the same item and never because a description matched.
 */
export function productIdentity(
  piece: Pick<
    GeneratedPiece,
    | "materialClass"
    | "thicknessMm"
    | "widthMm"
    | "lengthMm"
    | "densityKgM3"
    | "diameterMm"
  >,
): string {
  const family =
    piece.materialClass === "CURVED" || piece.materialClass === "CIRCULAR"
      ? "CURVED"
      : "FLAT";
  const diameter =
    piece.diameterMm === null || piece.diameterMm === undefined
      ? "-"
      : mm(piece.diameterMm);
  return [
    "ACROW-BOARD",
    family,
    mm(piece.thicknessMm),
    mm(piece.widthMm),
    mm(piece.lengthMm),
    mm(piece.densityKgM3),
    diameter,
  ].join("|");
}

/**
 * The commercial context a line is priced in. Two pieces of the same product
 * still take separate lines when this differs, because merging them would
 * change what the quotation charges.
 */
export function commercialContext(piece: GeneratedPiece): string {
  return [
    piece.currencyCode.toUpperCase(),
    piece.unitPrice.toFixed(4),
    (piece.discountPct ?? 0).toFixed(4),
  ].join("|");
}

/**
 * The catalogue item matching a generated board, by dimensions rather than by
 * name. The product master states its sizes inside the description — its
 * `thickness_mm`, `width_mm` and `length_mm` columns are null on all 2,927
 * rows — so the description is parsed and the numbers compared.
 *
 * Width and length are compared unordered: a 420 × 2000 board and a
 * 2000 × 420 board are the same board cut the same way.
 */
export function resolveItemCode(
  piece: Pick<GeneratedPiece, "thicknessMm" | "widthMm" | "lengthMm">,
  catalogue: readonly LookupProduct[],
): LookupProduct | null {
  const wanted = [piece.widthMm, piece.lengthMm]
    .map((value) => mm(value))
    .sort();
  const thickness = mm(piece.thicknessMm);
  const matches = catalogue.filter((product) => {
    const parsed = parseBoardDimensions(product.canonicalDescription);
    if (parsed === null) return false;
    if (mm(parsed.thicknessMm) !== thickness) return false;
    const have = [parsed.widthMm, parsed.lengthMm].map((v) => mm(v)).sort();
    return have[0] === wanted[0] && have[1] === wanted[1];
  });
  // Two catalogue items with the same three dimensions are two different
  // products the description distinguishes some other way. Picking one would
  // be a guess with a code attached to it.
  return matches.length === 1 && matches[0] !== undefined ? matches[0] : null;
}

export interface ConsolidateOptions {
  catalogue?: readonly LookupProduct[] | undefined;
}

/**
 * Generated pieces in, quotation lines out.
 *
 * The order of first appearance is kept, so a reader sees the lines in the
 * order the scopes were entered rather than in whatever order a map iterated.
 */
export function consolidateQuotationLines(
  pieces: readonly GeneratedPiece[],
  options: ConsolidateOptions = {},
): ConsolidatedLine[] {
  const catalogue = options.catalogue ?? [];
  const byKey = new Map<string, ConsolidatedLine>();
  const order: string[] = [];

  for (const piece of pieces) {
    if (!(piece.qty > 0)) continue;
    const identity = productIdentity(piece);
    const key = `${identity}#${commercialContext(piece)}`;
    const existing = byKey.get(key);

    if (existing !== undefined) {
      existing.qty += piece.qty;
      existing.lineTotal = existing.unitPrice * existing.qty;
      existing.totalWeightKg = pieceWeightKg(piece) * existing.qty;
      const source = existing.sources.find(
        (entry) => entry.label === piece.sourceLabel,
      );
      if (source === undefined)
        existing.sources.push({ label: piece.sourceLabel, qty: piece.qty });
      else source.qty += piece.qty;
      continue;
    }

    // A code chosen on the row only survives if the board the row ended up
    // delivering is still that product. Pasting a code and then letting the
    // takeoff generate different panel sizes would otherwise attach a real
    // catalogue code to a board that is not the one it names.
    const chosen =
      piece.productId != null && piece.productId !== ""
        ? (catalogue.find((item) => item.productId === piece.productId) ?? null)
        : null;
    const chosenStillFits = chosen !== null && dimensionsMatch(piece, chosen);
    const matched = chosenStillFits
      ? chosen
      : resolveItemCode(piece, catalogue);
    const code = matched?.skuCode ?? null;
    const codeStatus: CodeStatus =
      piece.outsideCatalogue === true
        ? "UNCODED"
        : code != null && normalizeCode(code) !== ""
          ? "CODED"
          : "CODE_PENDING";

    byKey.set(key, {
      identity,
      itemCode: codeStatus === "CODED" ? code : null,
      codeStatus,
      // One template for every screen, so the same board never reads two ways.
      description: boardDescriptor({
        materialClass: piece.materialClass,
        thicknessMm: piece.thicknessMm,
        widthMm: piece.widthMm,
        lengthMm: piece.lengthMm,
        ...(piece.diameterMm == null ? {} : { diameterMm: piece.diameterMm }),
      }),
      thicknessMm: piece.thicknessMm,
      widthMm: piece.widthMm,
      lengthMm: piece.lengthMm,
      qty: piece.qty,
      unitPrice: piece.unitPrice,
      lineTotal: piece.unitPrice * piece.qty,
      currencyCode: piece.currencyCode,
      totalWeightKg: pieceWeightKg(piece) * piece.qty,
      sources: [{ label: piece.sourceLabel, qty: piece.qty }],
    });
    order.push(key);
  }

  return order
    .map((key) => byKey.get(key))
    .filter((line): line is ConsolidatedLine => line !== undefined);
}

/** Does this catalogue item state the same three dimensions as the board? */
function dimensionsMatch(
  piece: Pick<GeneratedPiece, "thicknessMm" | "widthMm" | "lengthMm">,
  product: LookupProduct,
): boolean {
  const parsed = parseBoardDimensions(product.canonicalDescription);
  if (parsed === null) return false;
  if (mm(parsed.thicknessMm) !== mm(piece.thicknessMm)) return false;
  const have = [parsed.widthMm, parsed.lengthMm].map((v) => mm(v)).sort();
  const want = [piece.widthMm, piece.lengthMm].map((v) => mm(v)).sort();
  return have[0] === want[0] && have[1] === want[1];
}

function pieceWeightKg(piece: GeneratedPiece): number {
  return (
    (piece.widthMm / 1000) *
    (piece.lengthMm / 1000) *
    (piece.thicknessMm / 1000) *
    piece.densityKgM3
  );
}

/**
 * Consolidation must not change what the quotation is worth. This compares
 * the two totals so a screen can assert it rather than assume it.
 */
export function consolidationIsValueNeutral(
  pieces: readonly GeneratedPiece[],
  lines: readonly ConsolidatedLine[],
): boolean {
  const before = pieces.reduce(
    (sum, piece) => sum + (piece.qty > 0 ? piece.unitPrice * piece.qty : 0),
    0,
  );
  const after = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return Math.abs(before - after) <= Math.max(0.01, before * 0.000001);
}

/**
 * A scope's own schedule, expanded into the distinct boards it delivers.
 *
 * A rectangular column returns a panel schedule and a circular one an arc
 * schedule, each already holding the distinct sizes and their counts. The
 * screens were reading only `pieces[0]` and reporting the rest as
 * `(+3 sizes)`, which is how a quotation came to omit most of what it was
 * selling. Everything the schedule lists is expanded here.
 */
/** To the piastre, half up: the rule `Decimal.ROUND_HALF_UP` applies server-side. */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
export function piecesFromScope(input: {
  sourceLabel: string;
  materialClass: BoardDescriptorClass;
  thicknessMm: number;
  densityKgM3: number;
  /**
   * Used for a board priced as a board. Every piece derived from a rate uses
   *  instead, because a 1200 mm piece and a 400 mm piece off the
   * same column are not the same price — and one price applied to both is
   * exactly the bug this replaced.
   */
  unitPrice: number;
  /** EGP per kg. When given, each piece is priced from its own weight. */
  pricePerKg?: number | undefined;
  currencyCode: string;
  discountPct?: number | undefined;
  productId?: string | null | undefined;
  outsideCatalogue?: boolean | undefined;
  diameterMm?: number | null | undefined;
  /** Rectangular / irregular columns, cores and walls. */
  panels?:
    | readonly { widthMm: number; lengthMm: number; totalCount: number }[]
    | undefined;
  /** Circular columns. */
  arcPieces?:
    | readonly { widthMm: number; heightMm: number; totalCount: number }[]
    | undefined;
  /** A plain board, which has no schedule of its own. */
  flat?: { widthMm: number; lengthMm: number; qty: number } | undefined;
}): GeneratedPiece[] {
  // A piece's own price, from its own dimensions -- rounded to the piastre,
  // half up, exactly as the server rounds it before multiplying by the count.
  // Left at full precision, 40 panels at 1,041.3867 made 41,655.47 on the
  // summary while the saved quotation, at 1,041.39 each, said 41,655.60: the
  // page the customer reads and the total they are charged disagreed by
  // thirteen piastres.
  const priceFor = (widthMm: number, lengthMm: number): number => {
    if (input.pricePerKg === undefined) return input.unitPrice;
    const weightKg =
      (widthMm / 1000) *
      (lengthMm / 1000) *
      (input.thicknessMm / 1000) *
      input.densityKgM3;
    return roundMoney(weightKg * input.pricePerKg);
  };
  const common = {
    sourceLabel: input.sourceLabel,
    materialClass: input.materialClass,
    thicknessMm: input.thicknessMm,
    densityKgM3: input.densityKgM3,
    unitPrice: input.unitPrice,
    currencyCode: input.currencyCode,
    ...(input.discountPct === undefined
      ? {}
      : { discountPct: input.discountPct }),
    ...(input.productId == null ? {} : { productId: input.productId }),
    ...(input.outsideCatalogue === undefined
      ? {}
      : { outsideCatalogue: input.outsideCatalogue }),
    ...(input.diameterMm == null ? {} : { diameterMm: input.diameterMm }),
  };

  if (input.panels !== undefined && input.panels.length > 0)
    return input.panels.map((panel) => ({
      ...common,
      widthMm: panel.widthMm,
      lengthMm: panel.lengthMm,
      qty: panel.totalCount,
      unitPrice: priceFor(panel.widthMm, panel.lengthMm),
    }));

  if (input.arcPieces !== undefined && input.arcPieces.length > 0)
    return input.arcPieces.map((arc) => ({
      ...common,
      widthMm: arc.widthMm,
      lengthMm: arc.heightMm,
      qty: arc.totalCount,
      unitPrice: priceFor(arc.widthMm, arc.heightMm),
    }));

  if (input.flat !== undefined)
    return [
      {
        ...common,
        widthMm: input.flat.widthMm,
        lengthMm: input.flat.lengthMm,
        qty: input.flat.qty,
        unitPrice: priceFor(input.flat.widthMm, input.flat.lengthMm),
      },
    ];

  return [];
}
