import { parseBoardDimensions } from "./cargo-bundling.ts";

/**
 * Finding a catalogue item from a code somebody typed or pasted.
 *
 * A salesperson working from a BOQ or an ERP export has the item code, not
 * the description — `2001030008403`, or `PRD-00000040`. Typing the board's
 * description back out by hand is the step where a 12 mm board becomes an
 * 18 mm one.
 *
 * A code is matched exactly, and only an exact match fills a row on its own.
 * Anything else comes back as candidates for a person to choose from, because
 * the wrong board on a quotation is priced, sent and delivered before anybody
 * notices.
 *
 * The dimensions come out of the item's **description**, not its columns:
 * `thickness_mm`, `width_mm`, `length_mm`, `weight_kg` and `density_kg_m3`
 * are null on all 2,927 products, while 2,735 descriptions state the sizes in
 * full (`Acrow Board 12 mm × 585 mm × 885 mm ( M Board )`).
 */

export interface LookupProduct {
  productId: string;
  skuCode?: string | null | undefined;
  barcode?: string | null | undefined;
  canonicalDescription: string;
}

export interface ProductMatch {
  product: LookupProduct;
  /** How it was found — shown to the person, never hidden. */
  on: "SKU" | "BARCODE" | "DESCRIPTION";
  exact: boolean;
}

/** Codes vary by separator and case between the ERP, a BOQ and a paste. */
export function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

export interface LookupResult {
  /** Safe to apply without asking: one exact code match and nothing else. */
  applyDirectly: LookupProduct | null;
  /** Everything worth offering, best first. */
  candidates: ProductMatch[];
}

export function lookupProduct(
  typed: string,
  products: readonly LookupProduct[],
): LookupResult {
  const code = normalizeCode(typed);
  if (code === "") return { applyDirectly: null, candidates: [] };

  const exact: ProductMatch[] = [];
  const partial: ProductMatch[] = [];
  const text = typed.trim().toLowerCase();

  for (const product of products) {
    const sku = normalizeCode(product.skuCode ?? "");
    const barcode = normalizeCode(product.barcode ?? "");
    if (sku !== "" && sku === code) {
      exact.push({ product, on: "SKU", exact: true });
      continue;
    }
    if (barcode !== "" && barcode === code) {
      exact.push({ product, on: "BARCODE", exact: true });
      continue;
    }
    // The start of a code offers every code that begins with it — someone
    // typing 20010300 is looking for one of those items — but never applies
    // one on its own.
    if (
      code.length >= 4 &&
      ((sku !== "" && sku.startsWith(code)) ||
        (barcode !== "" && barcode.startsWith(code)))
    ) {
      partial.push({
        product,
        on: sku !== "" && sku.startsWith(code) ? "SKU" : "BARCODE",
        exact: false,
      });
      continue;
    }
    // A description match needs enough to go on: two characters match half
    // the catalogue and would bury the real answer.
    if (
      text.length >= 3 &&
      product.canonicalDescription.toLowerCase().includes(text)
    )
      partial.push({ product, on: "DESCRIPTION", exact: false });
  }

  const candidates = [...exact, ...partial];
  return {
    applyDirectly:
      exact.length === 1 && exact[0] !== undefined ? exact[0].product : null,
    candidates,
  };
}

export interface ProductFill {
  productId: string;
  description: string;
  thicknessMm?: string;
  widthMm?: string;
  lengthMm?: string;
}

/**
 * What a chosen item writes into the row. Dimensions are only written when
 * the description actually states them — an item that does not say its sizes
 * leaves whatever was typed alone rather than blanking it.
 */
export function fillFromProduct(product: LookupProduct): ProductFill {
  const parsed = parseBoardDimensions(product.canonicalDescription);
  const fill: ProductFill = {
    productId: product.productId,
    description: product.canonicalDescription,
  };
  if (parsed === null) return fill;
  return {
    ...fill,
    thicknessMm: String(parsed.thicknessMm),
    widthMm: String(parsed.widthMm),
    lengthMm: String(parsed.lengthMm),
  };
}

/**
 * Every code the catalogue holds for the board a line describes.
 *
 * This is the question a salesperson actually has. Thirty-one products share
 * `18 x 1220 x 2440` and differ by crust, logo, family or radius, so "the code
 * for an 18 mm board" has no single answer — and picking one for them is how a
 * quotation goes out against the wrong variant. So the size is used to find the
 * candidates and a person chooses between them.
 *
 * Matching is on the **dimensions** rather than the wording, because the
 * wording is the part that differs: `Acrow Board 18 mm x 1220 mm x 2440 mm
 * ( M Board )` and `ACROW BOARD 18mm*1220mm*2440mm - F17` are the same board in
 * two hands. When a line has no dimensions to go on, the typed text is used
 * instead, which at least narrows it.
 *
 * `filter` is what the person has typed into the picker's own search box; it
 * narrows the list without changing what counts as a candidate.
 */
export interface CodeQuery {
  /** The line's description, used when there are no dimensions to match on. */
  readonly description?: string | undefined;
  readonly thicknessMm?: number | undefined;
  readonly widthMm?: number | undefined;
  readonly lengthMm?: number | undefined;
}

export interface CodeOption {
  readonly product: LookupProduct;
  /** The code to write on the line: the SKU, or the barcode when there is none. */
  readonly code: string;
  /** Why it is on the list, so the person is never guessing. */
  readonly on: "SIZE" | "DESCRIPTION";
}

/**
 * The same size, to a tenth of a millimetre: 2440 and 2440.0 are one board.
 *
 * This was a whole millimetre, which is the difference between two products:
 * 18 mm matched a 17 mm board, 21 mm a 20 mm one, 15 x 583 x 2983 a
 * 14.5 x 582 x 2982 one. The list is sorted by description, "17 mm" sorts
 * before "18 mm", and the automatic code takes the first -- so an 18 mm line
 * was saved with a 17 mm board's code. The summary, which matches exactly,
 * rightly refused it and showed "Pending"; now the two agree.
 */
const SAME_MM = 0.05;

function sameSize(a: number | undefined, b: number | undefined): boolean {
  return a !== undefined && b !== undefined && Math.abs(a - b) <= SAME_MM;
}

/** Width and length either way round: 420 x 2000 is 2000 x 420 cut the same. */
function sameFootprint(
  have: { widthMm: number; lengthMm: number },
  wanted: { widthMm?: number | undefined; lengthMm?: number | undefined },
): boolean {
  return (
    (sameSize(have.widthMm, wanted.widthMm) &&
      sameSize(have.lengthMm, wanted.lengthMm)) ||
    (sameSize(have.widthMm, wanted.lengthMm) &&
      sameSize(have.lengthMm, wanted.widthMm))
  );
}

export function codeOptions(
  query: CodeQuery,
  products: readonly LookupProduct[],
  filter = "",
): CodeOption[] {
  const wanted = {
    thicknessMm: query.thicknessMm,
    widthMm: query.widthMm,
    lengthMm: query.lengthMm,
  };
  const hasSize =
    wanted.thicknessMm !== undefined &&
    wanted.widthMm !== undefined &&
    wanted.lengthMm !== undefined;
  const text = (query.description ?? "").trim().toLowerCase();
  const narrow = filter.trim().toLowerCase();
  const narrowCode = normalizeCode(filter);

  const options: CodeOption[] = [];
  for (const product of products) {
    const code =
      (product.skuCode ?? "").trim() || (product.barcode ?? "").trim();
    // A product with no code cannot answer the question being asked.
    if (code === "") continue;

    const parsed = parseBoardDimensions(product.canonicalDescription);
    const bySize =
      hasSize &&
      parsed !== null &&
      sameSize(parsed.thicknessMm, wanted.thicknessMm) &&
      sameFootprint(parsed, wanted);
    // Falling back to the words only when there is no size to match on: a
    // description search run alongside a size match buries the right answers.
    const byText =
      !hasSize &&
      text.length >= 3 &&
      product.canonicalDescription.toLowerCase().includes(text);
    if (!bySize && !byText) continue;

    if (narrow !== "") {
      const matchesFilter =
        product.canonicalDescription.toLowerCase().includes(narrow) ||
        normalizeCode(code).includes(narrowCode);
      if (!matchesFilter) continue;
    }
    options.push({ product, code, on: bySize ? "SIZE" : "DESCRIPTION" });
  }

  // Alphabetical by description, so the same board is in the same place every
  // time the picker is opened rather than wherever the catalogue put it.
  return options.sort((a, b) =>
    a.product.canonicalDescription.localeCompare(
      b.product.canonicalDescription,
    ),
  );
}
