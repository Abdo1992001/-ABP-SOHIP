import { describe, expect, it } from "vitest";
import {
  codeOptions,
  fillFromProduct,
  lookupProduct,
  normalizeCode,
} from "./product-lookup.ts";

/**
 * The codes and descriptions below are real rows from the product master.
 */

const first = {
  productId: "p1",
  skuCode: "2001030008403",
  barcode: null,
  canonicalDescription:
    "Acrow Board 12 mm × 585 mm × 885 mm ( M Board ) With Tie-Rod Holes ( PERI ALpha ) ( Light Grey )",
};

const catalogue = [
  first,
  {
    productId: "p2",
    skuCode: "2001030008402",
    barcode: null,
    canonicalDescription:
      "Acrow Board 12 mm × 885 mm × 1485 mm ( M Board ) With Tie-Rod Holes ( PERI ALpha ) ( Light Grey )",
  },
  {
    productId: "p3",
    skuCode: "2001030006755",
    barcode: null,
    canonicalDescription:
      "Acrow Board T=6 mm D=20 mm ( M Board ) ( REPAIR PLUG (CIRCULAR) PVC Repairing Spots )",
  },
];

describe("reading a pasted code", () => {
  it("ignores the separators and case a paste picks up", () => {
    expect(normalizeCode(" 2001-0300 08403 ")).toBe("2001030008403");
  });

  it("finds the item by its ERP code", () => {
    const found = lookupProduct("2001030008403", catalogue);
    expect(found.applyDirectly?.productId).toBe("p1");
    expect(found.candidates[0]?.on).toBe("SKU");
  });

  it("fills a row straight away when exactly one code matches", () => {
    expect(
      lookupProduct("2001030006755", catalogue).applyDirectly?.productId,
    ).toBe("p3");
  });

  it("offers matches on the description without choosing one", () => {
    const found = lookupProduct("885 mm", catalogue);
    // Both 12mm boards mention 885; neither is a code match, so neither is
    // applied — the wrong board priced and shipped is not a recoverable error.
    expect(found.applyDirectly).toBeNull();
    expect(found.candidates.length).toBe(2);
  });

  it("offers every code that starts with what was typed, without choosing", () => {
    const found = lookupProduct("20010300084", catalogue);
    expect(found.applyDirectly).toBeNull();
    expect(found.candidates.map((match) => match.product.productId)).toEqual([
      "p1",
      "p2",
    ]);
    expect(found.candidates[0]?.on).toBe("SKU");
  });

  it("stays quiet for a fragment too short to mean anything", () => {
    expect(lookupProduct("mm", catalogue).candidates).toEqual([]);
  });

  it("finds nothing for a code the catalogue does not hold", () => {
    const found = lookupProduct("9999999999999", catalogue);
    expect(found.applyDirectly).toBeNull();
    expect(found.candidates).toEqual([]);
  });

  it("does not match an empty code against every item without a code", () => {
    const withBlanks = [
      {
        productId: "x",
        skuCode: "",
        barcode: "",
        canonicalDescription: "Board",
      },
    ];
    expect(lookupProduct("", withBlanks).candidates).toEqual([]);
  });
});

describe("what a chosen item writes into the row", () => {
  it("takes the dimensions out of the description", () => {
    const fill = fillFromProduct(first);
    expect(fill).toEqual({
      productId: "p1",
      description: first.canonicalDescription,
      thicknessMm: "12",
      widthMm: "585",
      lengthMm: "885",
    });
  });

  it("writes no dimensions when the item does not state them", () => {
    const fill = fillFromProduct({
      productId: "p9",
      skuCode: "X",
      barcode: null,
      canonicalDescription: "Acrow M-Board Circular Repair Plug",
    });
    expect(fill.thicknessMm).toBeUndefined();
    expect(fill.description).toBe("Acrow M-Board Circular Repair Plug");
  });
});

/**
 * The variants below are the real problem: the product master holds thirty-one
 * items at 18 x 1220 x 2440 that differ only by crust, logo or family, so the
 * question "what is the code for an 18 mm board" has thirty-one answers and
 * the system's job is to show them, not to choose.
 */
const variants = [
  {
    productId: "v1",
    skuCode: "2001030001001",
    barcode: null,
    canonicalDescription:
      "Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm ( M Board ) ( Brown )",
  },
  {
    productId: "v2",
    skuCode: "2001030001002",
    barcode: null,
    canonicalDescription:
      "Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm ( F Board ) ( Black ) With Logo",
  },
  {
    productId: "v3",
    skuCode: "2001030001003",
    barcode: null,
    canonicalDescription:
      "Acrow Board 18 mm \u00d7 1220 mm \u00d7 2500 mm ( M Board ) ( Brown )",
  },
  {
    productId: "v4",
    skuCode: null,
    barcode: "6221000001004",
    canonicalDescription:
      "Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm ( M Board ) ( Film Faced )",
  },
  {
    productId: "v5",
    skuCode: null,
    barcode: null,
    canonicalDescription:
      "Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm ( No Code )",
  },
];

const size = { thicknessMm: 18, widthMm: 1220, lengthMm: 2440 };

describe("every code for the board on this line", () => {
  it("offers each variant of the same size", () => {
    const options = codeOptions(size, variants);
    expect(options.map((option) => option.product.productId).sort()).toEqual([
      "v1",
      "v2",
      "v4",
    ]);
  });

  it("leaves out a board that is a different size", () => {
    const options = codeOptions(size, variants);
    expect(options.map((option) => option.product.productId)).not.toContain(
      "v3",
    );
  });

  // A millimetre is the difference between two products. The lookup used to
  // allow one, and an 18 mm line was saved with a 17 mm board's code.
  it("does not offer a board a millimetre thinner or narrower", () => {
    const near = (id: string, description: string) => ({
      productId: id,
      skuCode: id.toUpperCase(),
      barcode: null,
      canonicalDescription: description,
    });
    const catalogue = [
      near("t17", "Acrow Board 17 mm × 1220 mm × 2440 mm ( M Board )"),
      near("t18", "Acrow Board 18 mm × 1220 mm × 2440 mm ( M Board )"),
      near("n582", "Acrow Board 14.5 mm × 582 mm × 2982 mm ( M Board )"),
      near("n583", "Acrow Board 15 mm × 583 mm × 2983 mm ( M Board )"),
    ];
    const ids = (query: typeof size) =>
      codeOptions(query, catalogue).map((option) => option.product.productId);
    expect(ids(size)).toEqual(["t18"]);
    expect(ids({ thicknessMm: 15, widthMm: 583, lengthMm: 2983 })).toEqual([
      "n583",
    ]);
  });

  it("finds the board with its width and length given the other way round", () => {
    const options = codeOptions(
      { thicknessMm: 18, widthMm: 2440, lengthMm: 1220 },
      variants,
    );
    expect(options.map((option) => option.product.productId).sort()).toEqual([
      "v1",
      "v2",
      "v4",
    ]);
  });

  it("leaves out an item with no code, because a code is what is wanted", () => {
    const options = codeOptions(size, variants);
    expect(options.map((option) => option.product.productId)).not.toContain(
      "v5",
    );
  });

  it("falls back to the barcode when there is no SKU", () => {
    const found = codeOptions(size, variants).find(
      (option) => option.product.productId === "v4",
    );
    expect(found?.code).toBe("6221000001004");
  });

  it("matches a board typed with width and length the other way round", () => {
    const options = codeOptions(
      { thicknessMm: 12, widthMm: 885, lengthMm: 585 },
      catalogue,
    );
    expect(options.map((option) => option.product.productId)).toEqual(["p1"]);
  });

  it("says it matched on size", () => {
    for (const option of codeOptions(size, variants))
      expect(option.on).toBe("SIZE");
  });

  it("lists them in the same order every time", () => {
    const once = codeOptions(size, variants).map((option) => option.code);
    const twice = codeOptions(size, [...variants].reverse()).map(
      (option) => option.code,
    );
    expect(twice).toEqual(once);
  });

  // The summary compares to a tenth of a millimetre, so the code here must
  // too -- otherwise the row shows a code the summary then calls "Pending".
  it("treats a size written to a decimal place as the same board", () => {
    const options = codeOptions(
      { thicknessMm: 18.0, widthMm: 1220.0, lengthMm: 2440.02 },
      variants,
    );
    expect(options.length).toBe(3);
  });

  it("does not stretch a tenth of a millimetre into a different size", () => {
    const options = codeOptions(
      { thicknessMm: 18, widthMm: 1220.4, lengthMm: 2440 },
      variants,
    );
    expect(options.length).toBe(0);
  });

  it("narrows to what the person types in the picker", () => {
    expect(
      codeOptions(size, variants, "F Board").map(
        (option) => option.product.productId,
      ),
    ).toEqual(["v2"]);
  });

  it("narrows on the code as readily as on the words", () => {
    expect(
      codeOptions(size, variants, "2001-0300 01001").map(
        (option) => option.product.productId,
      ),
    ).toEqual(["v1"]);
  });

  it("searches the wording when the line has no size yet", () => {
    const options = codeOptions({ description: "film faced" }, variants);
    expect(options.map((option) => option.product.productId)).toEqual(["v4"]);
  });

  it("offers nothing on a line with neither a size nor enough words", () => {
    expect(codeOptions({ description: "ac" }, variants)).toEqual([]);
    expect(codeOptions({}, variants)).toEqual([]);
  });
});
