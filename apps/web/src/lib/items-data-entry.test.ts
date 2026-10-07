import { describe, expect, it } from "vitest";
import {
  applyCatalogueItem,
  blankItemRow,
  gridTotals,
  impliedPricePerKg,
  rowFigures,
  type ItemRow,
} from "./items-data-entry.ts";
import { WORKBOOK } from "./workbook-defaults.ts";

/**
 * The catalogue descriptions below are real rows from the product master.
 */

const row = (patch: Partial<ItemRow> = {}): ItemRow => ({
  ...blankItemRow("r1"),
  ...patch,
});

describe("a new row", () => {
  it("arrives pre-filled the way the sheet pre-fills it", () => {
    const fresh = blankItemRow("r1");
    expect(fresh.thicknessMm).toBe("18");
    expect(fresh.widthMm).toBe("2440");
    expect(fresh.densityKgM3).toBe("600");
  });

  it("leaves length and quantity to the person, since nothing can guess them", () => {
    const fresh = blankItemRow("r1");
    expect(fresh.lengthMm).toBe("");
    expect(fresh.qty).toBe("");
  });
});

describe("choosing a catalogue item", () => {
  it("fills the dimensions out of the item's description", () => {
    // The product columns are null on all 2,927 products; the dimensions are
    // only in the description, so that is what is read.
    const filled = applyCatalogueItem(row(), {
      productId: "p1",
      label: "Acrow Board 12mm",
      description:
        "Acrow Board 12 mm × 585 mm × 885 mm ( M Board ) With Tie-Rod Holes",
    });
    expect(filled.thicknessMm).toBe("12");
    expect(filled.widthMm).toBe("585");
    expect(filled.lengthMm).toBe("885");
    expect(filled.productId).toBe("p1");
  });

  it("keeps what was typed when the item states no dimensions", () => {
    const typed = row({ thicknessMm: "15", widthMm: "1220", lengthMm: "2440" });
    const filled = applyCatalogueItem(typed, {
      productId: "p2",
      label: "Repair plug",
      description: "Acrow M-Board Circular Repair Plug",
    });
    expect(filled.productId).toBe("p2");
    expect(filled.thicknessMm).toBe("15");
    expect(filled.lengthMm).toBe("2440");
  });
});

describe("what a row implies", () => {
  it("derives the weight the workbook derives", () => {
    // 1.220 x 2.440 x 0.018 x 600 = 32.149 kg, the sheet's reference board.
    const figures = rowFigures(
      row({ widthMm: "1220", lengthMm: "2440", qty: "10" }),
      WORKBOOK.standardPricePerKg,
    );
    expect(figures.weightKgPerPiece).toBeCloseTo(32.149, 3);
    expect(figures.totalWeightKg).toBeCloseTo(321.49, 2);
  });

  it("prices the piece off the rate, at the sheet's own figure", () => {
    const figures = rowFigures(
      row({ widthMm: "1220", lengthMm: "2440", qty: "1" }),
      WORKBOOK.standardPricePerKg,
    );
    expect(figures.unitPrice).toBeCloseTo(2500, 2);
    expect(figures.lineTotal).toBeCloseTo(2500, 2);
  });

  it("stays quiet until the row has a length", () => {
    const figures = rowFigures(row({ qty: "5" }), 77.76);
    expect(figures.complete).toBe(false);
    expect(figures.unitPrice).toBe(0);
  });

  it("does not price a row with no quantity yet", () => {
    const figures = rowFigures(
      row({ widthMm: "1220", lengthMm: "2440" }),
      WORKBOOK.standardPricePerKg,
    );
    // The piece weight is known and shown; the line total is not invented.
    expect(figures.weightKgPerPiece).toBeCloseTo(32.149, 3);
    expect(figures.lineTotal).toBe(0);
    expect(figures.complete).toBe(false);
  });

  it("refuses a density of zero rather than dividing by it later", () => {
    const figures = rowFigures(
      row({ widthMm: "1220", lengthMm: "2440", qty: "1", densityKgM3: "0" }),
      77.76,
    );
    expect(figures.complete).toBe(false);
  });
});

describe("pricing in reverse", () => {
  it("turns a typed piece price back into the rate per kg", () => {
    const implied = impliedPricePerKg(
      row({ widthMm: "1220", lengthMm: "2440", qty: "1" }),
      2500,
    );
    expect(implied).toBeCloseTo(77.76, 2);
  });

  it("turns the sheet's own override back into its rate", () => {
    // 2,368.42 EGP a board is 73.67 EGP/kg, as the workbook prints it.
    const implied = impliedPricePerKg(
      row({ widthMm: "1220", lengthMm: "2440", qty: "1" }),
      2368.42,
    );
    expect(implied).toBeCloseTo(73.67, 2);
  });

  it("has no answer for a row whose weight is unknown", () => {
    expect(impliedPricePerKg(row({ lengthMm: "" }), 2500)).toBeNull();
  });
});

describe("the totals strip", () => {
  it("adds up only the rows that can be priced", () => {
    const totals = gridTotals(
      [
        row({ key: "a", widthMm: "1220", lengthMm: "2440", qty: "10" }),
        row({ key: "b", lengthMm: "", qty: "99" }),
      ],
      WORKBOOK.standardPricePerKg,
    );
    expect(totals.priced).toBe(1);
    expect(totals.weightKg).toBeCloseTo(321.49, 2);
    expect(totals.amount).toBeCloseTo(25000, 2);
    // The unpriced row's pieces still count: they are pieces somebody entered.
    expect(totals.pieces).toBe(109);
  });
});
