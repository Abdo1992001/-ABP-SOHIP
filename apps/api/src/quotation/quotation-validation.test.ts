import { describe, expect, it } from "vitest";
import {
  checkQuotationLine,
  rollUpQuotationStatus,
} from "./quotation-validation.js";

const ready = {
  materialClass: "STANDARD",
  description: "Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm (M Board)",
  quantity: 10,
  thicknessMm: 18,
  widthMm: 1220,
  lengthMm: 2440,
  densityKgM3: 720,
  appliedPricePerKg: 90,
  totalPieces: 10,
};

describe("checkQuotationLine", () => {
  it("passes a complete standard line", () => {
    expect(checkQuotationLine(ready).status).toBe("READY");
  });

  it("refuses a non-positive quantity", () => {
    expect(checkQuotationLine({ ...ready, quantity: 0 }).status).toBe(
      "CHECK_QUANTITY",
    );
  });

  it("refuses a zero density instead of pricing it at zero", () => {
    const result = checkQuotationLine({ ...ready, densityKgM3: 0 });
    expect(result.issues.some((i) => i.status === "CHECK_DENSITY")).toBe(true);
  });

  it("refuses a missing rate", () => {
    const result = checkQuotationLine({ ...ready, appliedPricePerKg: null });
    expect(result.issues.some((i) => i.status === "CHECK_PRICE")).toBe(true);
  });

  it("asks for a diameter or radius on a circular column", () => {
    expect(
      checkQuotationLine({
        ...ready,
        materialClass: "CIRCULAR",
        widthMm: null,
        lengthMm: null,
        columnHeightMm: 6000,
      }).status,
    ).toBe("ENTER_DIAMETER_OR_RADIUS");
  });

  it("accepts a diameter and radius that agree", () => {
    expect(
      checkQuotationLine({
        ...ready,
        materialClass: "CIRCULAR",
        widthMm: 1885,
        lengthMm: 1200,
        diameterMm: 1200,
        radiusMm: 600,
        columnHeightMm: 6000,
      }).status,
    ).toBe("READY");
  });

  it("catches a diameter that contradicts its radius", () => {
    expect(
      checkQuotationLine({
        ...ready,
        materialClass: "CIRCULAR",
        widthMm: 1885,
        lengthMm: 1200,
        diameterMm: 1200,
        radiusMm: 800,
        columnHeightMm: 6000,
      }).status,
    ).toBe("CHECK_DIAMETER_RADIUS_MISMATCH");
  });

  it("wants a column height on a circular column", () => {
    const result = checkQuotationLine({
      ...ready,
      materialClass: "CIRCULAR",
      widthMm: 1885,
      lengthMm: 1200,
      diameterMm: 1200,
      columnHeightMm: null,
    });
    expect(result.issues.some((i) => i.status === "CHECK_DIMENSIONS")).toBe(
      true,
    );
  });

  it("reports a schedule that delivered nothing", () => {
    const result = checkQuotationLine({ ...ready, totalPieces: 0 });
    expect(result.issues.some((i) => i.status === "CHECK_CALCULATION")).toBe(
      true,
    );
  });

  it("only needs a price on a manually priced line", () => {
    expect(
      checkQuotationLine({
        description: "Freight",
        quantity: 1,
        unitPrice: 5000,
      }).status,
    ).toBe("READY");
    expect(
      checkQuotationLine({ description: "Freight", quantity: 1, unitPrice: 0 })
        .status,
    ).toBe("CHECK_PRICE");
  });

  it("reports a broken custom formula", () => {
    const result = checkQuotationLine({ ...ready, formulaError: true });
    expect(result.issues.some((i) => i.status === "CHECK_FORMULA")).toBe(true);
  });
});

describe("rollUpQuotationStatus", () => {
  it("is READY only when every line is", () => {
    expect(rollUpQuotationStatus(["READY", "READY"])).toBe("READY");
    expect(rollUpQuotationStatus(["READY", "CHECK_PRICE", "READY"])).toBe(
      "CHECK_PRICE",
    );
  });
});
