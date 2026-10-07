import { describe, expect, it } from "vitest";
import { blankItemRow, rowFigures } from "../lib/items-data-entry.ts";
import {
  computeMaterialClassPreview,
  lineFromItemRow,
  type MaterialClass,
} from "./QuotationStudio.tsx";

/**
 * The quick-entry grid used to be a second list beside the line items that
 * was never saved. Its rows now become real lines, and a row must cost the
 * same once it is a line as it did in the grid.
 */
const rate = 77.76;
const companyRates: Record<MaterialClass, number> = {
  STANDARD: rate,
  REGULAR: rate,
  CURVED: rate,
  CIRCULAR: rate,
  CORE: rate,
  WALL: rate,
};

describe("lineFromItemRow", () => {
  const row = {
    ...blankItemRow("r1"),
    lengthMm: "1220",
    qty: "4",
  };

  it("keeps the row's sizes and leaves the price to the server", () => {
    const line = lineFromItemRow(row);
    expect(line.materialClass).toBe("STANDARD");
    expect(line.unitPrice).toBeNull();
    expect(line.qty).toBe("4");
    expect(line.thicknessMm).toBe(row.thicknessMm);
    expect(line.widthMm).toBe(row.widthMm);
    expect(line.lengthMm).toBe("1220");
    expect(line.densityKgM3).toBe(row.densityKgM3);
    expect(line.description).not.toBe("");
    expect(line.descriptionAuto).toBe(true);
  });

  it("prices the line the same as the grid row", () => {
    const line = lineFromItemRow(row);
    const preview = computeMaterialClassPreview(
      line,
      {
        standardPricePerKgOverride: "",
        curvedPricePerKgOverride: "",
        circularPricePerKgOverride: "",
        densityOverrideKgM3: "",
      },
      companyRates,
      600,
      18,
    );
    const figures = rowFigures(row, rate);
    expect(preview?.unitPrice).toBeCloseTo(figures.unitPrice, 2);
  });

  it("uses the catalogue item's name when one was picked", () => {
    const line = lineFromItemRow({
      ...row,
      productId: "p-1",
      productLabel: "Acrow Board 18 mm x 1220 mm x 2440 mm",
    });
    expect(line.productId).toBe("p-1");
    expect(line.description).toBe("Acrow Board 18 mm x 1220 mm x 2440 mm");
    expect(line.descriptionAuto).toBe(false);
  });
});
