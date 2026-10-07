import { describe, expect, it } from "vitest";
import {
  commercialContext,
  consolidateQuotationLines,
  consolidationIsValueNeutral,
  piecesFromScope,
  productIdentity,
  resolveItemCode,
  type GeneratedPiece,
} from "./quotation-consolidation.ts";

const piece = (patch: Partial<GeneratedPiece> = {}): GeneratedPiece => ({
  sourceLabel: "Core 01",
  materialClass: "STANDARD",
  thicknessMm: 18,
  widthMm: 420,
  lengthMm: 2000,
  densityKgM3: 600,
  qty: 2,
  unitPrice: 653.05,
  currencyCode: "EGP",
  ...patch,
});

/** Real rows from the product master. */
const catalogue = [
  {
    productId: "c1",
    skuCode: "2001030008403",
    barcode: null,
    canonicalDescription: "ACROW Board 18 mm × 420 mm × 2000 mm (M Board)",
  },
  {
    productId: "c2",
    skuCode: "2001030009217",
    barcode: null,
    canonicalDescription: "ACROW Board 18 mm × 600 mm × 2000 mm (M Board)",
  },
];

describe("what makes two items the same item", () => {
  it("is the attributes, not the description", () => {
    expect(productIdentity(piece())).toBe(productIdentity(piece()));
  });

  it("separates boards that differ in any dimension", () => {
    expect(productIdentity(piece())).not.toBe(
      productIdentity(piece({ widthMm: 600 })),
    );
    expect(productIdentity(piece())).not.toBe(
      productIdentity(piece({ thicknessMm: 15 })),
    );
  });

  it("separates boards of the same size in a different material", () => {
    // Density is what tells a gray board from an M board at the same size.
    expect(productIdentity(piece())).not.toBe(
      productIdentity(piece({ densityKgM3: 720 })),
    );
  });

  it("treats circular and curved as the one family they are sold as", () => {
    expect(productIdentity(piece({ materialClass: "CURVED" }))).toBe(
      productIdentity(piece({ materialClass: "CIRCULAR" })),
    );
  });

  it("does not fold a curve into a flat board of the same size", () => {
    expect(productIdentity(piece({ materialClass: "CURVED" }))).not.toBe(
      productIdentity(piece({ materialClass: "STANDARD" })),
    );
  });
});

describe("consolidating what the scopes generated", () => {
  it("adds up the same board from four scopes into one line", () => {
    const lines = consolidateQuotationLines([
      piece({ sourceLabel: "Core 01", qty: 2 }),
      piece({ sourceLabel: "Core 02", qty: 3 }),
      piece({ sourceLabel: "Wall W01", qty: 1 }),
      piece({ sourceLabel: "Column C01", qty: 2 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.qty).toBe(8);
    expect(lines[0]?.lineTotal).toBeCloseTo(653.05 * 8, 2);
  });

  it("keeps every distinct size as its own line", () => {
    // "(+3 sizes)" hid the rest of a column's schedule; a quotation has to
    // list what is being sold.
    const lines = consolidateQuotationLines([
      piece({ widthMm: 420 }),
      piece({ widthMm: 600 }),
      piece({ widthMm: 565, lengthMm: 1885 }),
    ]);
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.qty)).toEqual([2, 2, 2]);
  });

  it("keeps the scopes each line came from", () => {
    const lines = consolidateQuotationLines([
      piece({ sourceLabel: "Core 01", qty: 4 }),
      piece({ sourceLabel: "Wall W01", qty: 8 }),
      piece({ sourceLabel: "Core 01", qty: 4 }),
    ]);
    expect(lines[0]?.qty).toBe(16);
    expect(lines[0]?.sources).toEqual([
      { label: "Core 01", qty: 8 },
      { label: "Wall W01", qty: 8 },
    ]);
  });

  it("ignores a scope that generated nothing", () => {
    expect(consolidateQuotationLines([piece({ qty: 0 })])).toEqual([]);
  });
});

describe("when lines must NOT merge", () => {
  it("keeps two prices apart rather than averaging them", () => {
    const lines = consolidateQuotationLines([
      piece({ unitPrice: 653.05 }),
      piece({ unitPrice: 700 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(commercialContext(piece({ unitPrice: 653.05 }))).not.toBe(
      commercialContext(piece({ unitPrice: 700 })),
    );
  });

  it("keeps two currencies apart", () => {
    expect(
      consolidateQuotationLines([
        piece({ currencyCode: "EGP" }),
        piece({ currencyCode: "USD" }),
      ]),
    ).toHaveLength(2);
  });

  it("keeps a discounted line apart from an undiscounted one", () => {
    expect(
      consolidateQuotationLines([
        piece({ discountPct: 0 }),
        piece({ discountPct: 10 }),
      ]),
    ).toHaveLength(2);
  });
});

describe("item codes", () => {
  it("reuses the catalogue code when the dimensions match exactly", () => {
    const lines = consolidateQuotationLines([piece()], { catalogue });
    expect(lines[0]?.itemCode).toBe("2001030008403");
    expect(lines[0]?.codeStatus).toBe("CODED");
  });

  it("matches a board whose width and length are the other way round", () => {
    const found = resolveItemCode(
      { thicknessMm: 18, widthMm: 2000, lengthMm: 420 },
      catalogue,
    );
    expect(found?.skuCode).toBe("2001030008403");
  });

  it("invents no code for a board the catalogue does not hold", () => {
    const lines = consolidateQuotationLines(
      [piece({ widthMm: 565, lengthMm: 1885 })],
      { catalogue },
    );
    expect(lines[0]?.itemCode).toBeNull();
    expect(lines[0]?.codeStatus).toBe("CODE_PENDING");
  });

  it("assigns no code when two catalogue items share the dimensions", () => {
    // Two products the same size are distinguished by something the
    // description holds and this does not read. Choosing one would attach a
    // real code to a guess.
    const sameSize = "ACROW Board 18 mm × 420 mm × 2000 mm (M Board)";
    const twins = [
      {
        productId: "t1",
        skuCode: "AAA",
        barcode: null,
        canonicalDescription: sameSize,
      },
      {
        productId: "t2",
        skuCode: "BBB",
        barcode: null,
        canonicalDescription: sameSize,
      },
    ];
    expect(resolveItemCode(piece(), twins)).toBeNull();
  });

  it("says uncoded, not pending, for an item deliberately outside the catalogue", () => {
    const lines = consolidateQuotationLines(
      [piece({ outsideCatalogue: true })],
      { catalogue },
    );
    expect(lines[0]?.codeStatus).toBe("UNCODED");
  });

  it("consolidates a coded row with an identical generated one", () => {
    // The same board entered by code once and derived from dimensions
    // elsewhere is one product, so it is one line.
    const lines = consolidateQuotationLines(
      [
        piece({ sourceLabel: "Typed by code", productId: "c1", qty: 5 }),
        piece({ sourceLabel: "Column C01", qty: 3 }),
      ],
      { catalogue },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.qty).toBe(8);
    expect(lines[0]?.itemCode).toBe("2001030008403");
  });
});

describe("the description every screen shows", () => {
  it("comes from the one template, with no size count appended", () => {
    const lines = consolidateQuotationLines([piece()]);
    expect(lines[0]?.description).toContain("18 mm");
    expect(lines[0]?.description).toContain("420");
    expect(lines[0]?.description).toContain("2000");
    expect(lines[0]?.description).not.toMatch(/\+\d+ sizes/);
  });
});

describe("consolidation must not change the money", () => {
  it("totals the same before and after", () => {
    const pieces = [
      piece({ sourceLabel: "A", qty: 2 }),
      piece({ sourceLabel: "B", qty: 3 }),
      piece({ widthMm: 600, unitPrice: 932.93, qty: 12 }),
      piece({ unitPrice: 700, qty: 1 }),
    ];
    const lines = consolidateQuotationLines(pieces);
    expect(consolidationIsValueNeutral(pieces, lines)).toBe(true);
  });

  it("notices when it would not be", () => {
    const pieces = [piece({ qty: 2 })];
    const wrong = consolidateQuotationLines(pieces).map((line) => ({
      ...line,
      lineTotal: line.lineTotal + 1,
    }));
    expect(consolidationIsValueNeutral(pieces, wrong)).toBe(false);
  });
});

describe("expanding a scope's schedule", () => {
  const base = {
    sourceLabel: "Column C01",
    materialClass: "REGULAR" as const,
    thicknessMm: 18,
    densityKgM3: 600,
    unitPrice: 653.05,
    currencyCode: "EGP",
  };

  it("returns every panel size a column delivers, not just the first", () => {
    const pieces = piecesFromScope({
      ...base,
      panels: [
        { widthMm: 420, lengthMm: 2000, totalCount: 8 },
        { widthMm: 600, lengthMm: 2000, totalCount: 4 },
        { widthMm: 565, lengthMm: 1885, totalCount: 2 },
      ],
    });
    expect(pieces).toHaveLength(3);
    expect(pieces.map((p) => p.qty)).toEqual([8, 4, 2]);
  });

  it("turns a column's schedule into distinct quotation lines", () => {
    const lines = consolidateQuotationLines(
      piecesFromScope({
        ...base,
        panels: [
          { widthMm: 420, lengthMm: 2000, totalCount: 8 },
          { widthMm: 420, lengthMm: 2000, totalCount: 4 },
          { widthMm: 600, lengthMm: 2000, totalCount: 4 },
        ],
      }),
    );
    // The two identical panels merge; the different one stays its own line.
    expect(lines).toHaveLength(2);
    expect(lines[0]?.qty).toBe(12);
    expect(lines[1]?.qty).toBe(4);
  });

  it("reads a circular schedule by its arc pieces", () => {
    const pieces = piecesFromScope({
      ...base,
      materialClass: "CIRCULAR",
      diameterMm: 1200,
      arcPieces: [
        { widthMm: 1885, heightMm: 1200, totalCount: 6 },
        { widthMm: 900, heightMm: 1200, totalCount: 2 },
      ],
    });
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.lengthMm).toBe(1200);
    expect(pieces[0]?.diameterMm).toBe(1200);
  });

  it("handles a plain board, which has no schedule", () => {
    const pieces = piecesFromScope({
      ...base,
      materialClass: "STANDARD",
      flat: { widthMm: 1220, lengthMm: 2440, qty: 40 },
    });
    expect(pieces).toEqual([
      expect.objectContaining({ widthMm: 1220, lengthMm: 2440, qty: 40 }),
    ]);
  });

  it("returns nothing for a scope with no schedule and no board", () => {
    expect(piecesFromScope({ ...base })).toEqual([]);
  });
});

describe("a code chosen on the row", () => {
  it("is dropped when the takeoff delivers a different board", () => {
    // Real case found in the browser: a code was pasted, the column then
    // generated 600 x 600 panels, and the 585 x 885 code stayed attached to
    // them. A code on the wrong board is worse than no code at all.
    const lines = consolidateQuotationLines(
      [
        piece({
          productId: "c1",
          thicknessMm: 18,
          widthMm: 600,
          lengthMm: 600,
        }),
      ],
      { catalogue },
    );
    expect(lines[0]?.codeStatus).toBe("CODE_PENDING");
    expect(lines[0]?.itemCode).toBeNull();
  });

  it("is kept when the board really is that product", () => {
    const lines = consolidateQuotationLines([piece({ productId: "c1" })], {
      catalogue,
    });
    expect(lines[0]?.itemCode).toBe("2001030008403");
  });
});

describe("a circular column prices each piece for itself", () => {
  // D = 200, H = 4000, T = 18, segments = 2, density 600, 120 EGP/kg.
  // Circumference = pi x 200 = 628.319 mm; developed width = 314.159 mm.
  // Height splits 3 x 1200 + 1 x 400, doubled by the two segments.
  const developedWidth = (Math.PI * 200) / 2;
  const circular = () =>
    piecesFromScope({
      sourceLabel: "Circular C01",
      materialClass: "CIRCULAR",
      thicknessMm: 18,
      densityKgM3: 600,
      unitPrice: 0,
      pricePerKg: 120,
      currencyCode: "EGP",
      diameterMm: 200,
      arcPieces: [
        { widthMm: developedWidth, heightMm: 1200, totalCount: 6 },
        { widthMm: developedWidth, heightMm: 400, totalCount: 2 },
      ],
    });

  it("gives the long piece and the short piece different prices", () => {
    const pieces = circular();
    expect(pieces[0]?.unitPrice).not.toBeCloseTo(pieces[1]?.unitPrice ?? 0, 2);
  });

  it("prices each piece from its own weight", () => {
    const pieces = circular();
    // 0.314159 x 1.2 x 0.018 x 600 = 4.0715 kg -> x 120 = 488.58
    expect(pieces[0]?.unitPrice).toBeCloseTo(488.58, 1);
    // 0.314159 x 0.4 x 0.018 x 600 = 1.3572 kg -> x 120 = 162.86
    expect(pieces[1]?.unitPrice).toBeCloseTo(162.86, 1);
  });

  it("keeps the two lengths as two quotation lines", () => {
    const lines = consolidateQuotationLines(circular());
    expect(lines).toHaveLength(2);
    expect(lines[0]?.qty).toBe(6);
    expect(lines[1]?.qty).toBe(2);
    expect(lines[0]?.lineTotal).toBeCloseTo(488.58 * 6, 0);
  });

  it("still uses the given price when no rate per kg applies", () => {
    // A standard board bought as a board keeps its board price.
    const pieces = piecesFromScope({
      sourceLabel: "Sheet",
      materialClass: "STANDARD",
      thicknessMm: 18,
      densityKgM3: 600,
      unitPrice: 2500,
      currencyCode: "EGP",
      flat: { widthMm: 1220, lengthMm: 2440, qty: 3 },
    });
    expect(pieces[0]?.unitPrice).toBe(2500);
  });
});

describe("piece prices match what the server saves", () => {
  it("rounds the unit price before multiplying, as the server does", () => {
    // 18 x 620 x 2000 at 600 kg/m³ is 13.392 kg; at 77.7621 EGP/kg that is
    // 1,041.3867 -- saved as 1,041.39. Forty of them are 41,655.60 on the
    // quotation, and the summary has to say the same.
    const pieces = piecesFromScope({
      sourceLabel: "L1",
      materialClass: "STANDARD",
      thicknessMm: 18,
      densityKgM3: 600,
      unitPrice: 0,
      pricePerKg: 77.7621,
      currencyCode: "EGP",
      flat: { widthMm: 620, lengthMm: 2000, qty: 40 },
    });
    expect(pieces[0]?.unitPrice).toBe(1041.39);
    expect((pieces[0]?.unitPrice ?? 0) * 40).toBeCloseTo(41655.6, 2);
  });
});
