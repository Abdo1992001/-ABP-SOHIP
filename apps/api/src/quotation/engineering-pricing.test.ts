import { describe, expect, it } from "vitest";
import { Prisma } from "@abp/database";
import {
  boardsPerUnitFromExtension,
  computeEngineeringUnitPrice,
  computeWeightKg,
  deriveStandardRate,
  linearPricePerKg,
  pricedQuantity,
  LINEAR_BOARD_WEIGHT_KG,
} from "./engineering-pricing.js";

// Fixtures ported from ABP Engineering Studio's test-calculation-regression.js
// (standardBoardPrice 3300 == priceAcrowBoard) so both systems agree on
// numbers for the same inputs.
describe("computeEngineeringUnitPrice", () => {
  const standardBoardPrice = new Prisma.Decimal("3300");

  it("prices a standard Linear sheet at the full board price", () => {
    const result = computeEngineeringUnitPrice(
      "LINEAR",
      {
        lengthMm: new Prisma.Decimal("1220"),
        widthMm: new Prisma.Decimal("2440"),
      },
      { standardBoardPrice },
    );
    expect(result.unitPrice.toString()).toBe("3300");
  });

  it("matches Engineering Studio's one-circular-item fixture", () => {
    const result = computeEngineeringUnitPrice(
      "WEIGHT_BASED",
      {
        lengthMm: new Prisma.Decimal("1413"),
        widthMm: new Prisma.Decimal("1200"),
        thicknessMm: new Prisma.Decimal("18"),
        densityKgM3: new Prisma.Decimal("720"),
        pricePerKg: new Prisma.Decimal("120"),
      },
      { standardBoardPrice },
    );
    expect(result.unitPrice.toString()).toBe("2637");
  });

  it("matches Engineering Studio's multiple-circular-items fixture", () => {
    const result = computeEngineeringUnitPrice(
      "WEIGHT_BASED",
      {
        lengthMm: new Prisma.Decimal("1800"),
        widthMm: new Prisma.Decimal("1000"),
        thicknessMm: new Prisma.Decimal("20"),
        densityKgM3: new Prisma.Decimal("720"),
        pricePerKg: new Prisma.Decimal("120"),
      },
      { standardBoardPrice },
    );
    expect(result.unitPrice.toString()).toBe("3110.4");
  });

  it("matches Engineering Studio's decimal-dimensions fixture, rounded to 0.05", () => {
    const result = computeEngineeringUnitPrice(
      "WEIGHT_BASED",
      {
        lengthMm: new Prisma.Decimal("1413.5"),
        widthMm: new Prisma.Decimal("1200.25"),
        thicknessMm: new Prisma.Decimal("17.5"),
        densityKgM3: new Prisma.Decimal("720"),
        pricePerKg: new Prisma.Decimal("120"),
      },
      { standardBoardPrice },
    );
    expect(result.unitPrice.toString()).toBe("2565.2");
  });

  it("prices zero when weight-based dimensions are omitted, matching Engineering Studio's zero-priced behavior", () => {
    const result = computeEngineeringUnitPrice(
      "WEIGHT_BASED",
      { lengthMm: new Prisma.Decimal("0"), widthMm: new Prisma.Decimal("0") },
      { standardBoardPrice },
    );
    expect(result.unitPrice.toString()).toBe("0");
  });

  it("records a breakdown snapshot for audit", () => {
    const result = computeEngineeringUnitPrice(
      "LINEAR",
      {
        lengthMm: new Prisma.Decimal("1220"),
        widthMm: new Prisma.Decimal("2440"),
      },
      { standardBoardPrice },
    );
    expect(result.breakdown.standardBoardPrice).toBe("3300");
    expect(result.breakdown.formula).toContain("price1MLinear");
  });
});

describe("computeWeightKg", () => {
  it("matches the ACROW BOARD sheet's CRV-0001 example: 1885x1200x18mm @720kg/m3", () => {
    const weightKg = computeWeightKg({
      lengthMm: new Prisma.Decimal("1885"),
      widthMm: new Prisma.Decimal("1200"),
      thicknessMm: new Prisma.Decimal("18"),
      densityKgM3: new Prisma.Decimal("720"),
    });
    expect(weightKg.toFixed(3)).toBe("29.316");
  });
});

describe("deriveStandardRate", () => {
  const referenceBoard = {
    referenceBoardWidthMm: new Prisma.Decimal("1220"),
    referenceBoardLengthMm: new Prisma.Decimal("2440"),
    defaultThicknessMm: new Prisma.Decimal("18"),
    defaultDensityKgM3: new Prisma.Decimal("720"),
  };

  it("derives the full board price from a price-per-kg input", () => {
    const result = deriveStandardRate({
      mode: "PRICE_PER_KG",
      standardPricePerKg: new Prisma.Decimal("90"),
      referenceBoard,
    });
    expect(result.boardWeightKg.toFixed(3)).toBe("38.579");
    expect(result.standardBoardPrice.toFixed(2)).toBe("3472.14");
  });

  it("derives the price per kg from a full board price input, inverting the same board weight", () => {
    const forward = deriveStandardRate({
      mode: "PRICE_PER_KG",
      standardPricePerKg: new Prisma.Decimal("90"),
      referenceBoard,
    });
    const backward = deriveStandardRate({
      mode: "BOARD_PRICE",
      standardBoardPrice: forward.standardBoardPrice,
      referenceBoard,
    });
    expect(backward.standardPricePerKg.toFixed(2)).toBe("90.00");
  });
});

describe("the sheet's quantity and weight rules", () => {
  it("derives boards per unit from the extension length", () => {
    // The sheet's default: 38 m of extension, 2.44 m boards.
    expect(boardsPerUnitFromExtension(new Prisma.Decimal("38"))).toBe(16);
    // Exact multiples do not gain a spare board.
    expect(boardsPerUnitFromExtension(new Prisma.Decimal("2.44"))).toBe(1);
    expect(boardsPerUnitFromExtension(new Prisma.Decimal("4.88"))).toBe(2);
    // A remainder does: the span still has to be covered.
    expect(boardsPerUnitFromExtension(new Prisma.Decimal("5"))).toBe(3);
    expect(boardsPerUnitFromExtension(new Prisma.Decimal("0"))).toBe(0);
  });

  it("multiplies Linear rows by the board count and leaves the rest alone", () => {
    expect(pricedQuantity("LINEAR", 3, 16)).toBe(48);
    // A curved or circular row is already a complete piece. Multiplying it by
    // the Linear extension would quote the order at sixteen times its value.
    expect(pricedQuantity("WEIGHT_BASED", 3, 16)).toBe(3);
    // An explicit direct entry overrides the extension for Linear too.
    expect(pricedQuantity("LINEAR", 3, 16, "direct")).toBe(3);
    // No extension configured means the entered quantity stands.
    expect(pricedQuantity("LINEAR", 3, 0)).toBe(3);
  });

  it("fixes a Linear board's weight instead of deriving it", () => {
    expect(LINEAR_BOARD_WEIGHT_KG.toString()).toBe("33");
    // 3300 EGP a board over 33 kg is 100 EGP/kg.
    expect(linearPricePerKg(new Prisma.Decimal("3300")).toString()).toBe("100");
    expect(linearPricePerKg(new Prisma.Decimal("0")).toString()).toBe("0");
  });

  it("agrees with the sheet's weight expression", () => {
    // Sheet:  (L/1000) * (W/1000) * thicknessMm * 0.72
    // Here:   (L/1000) * (W/1000) * (thicknessMm/1000) * 720
    const here = computeWeightKg({
      lengthMm: new Prisma.Decimal("2440"),
      widthMm: new Prisma.Decimal("1220"),
      thicknessMm: new Prisma.Decimal("18"),
      densityKgM3: new Prisma.Decimal("720"),
    });
    const sheet = new Prisma.Decimal("2440")
      .div(1000)
      .mul(new Prisma.Decimal("1220").div(1000))
      .mul(18)
      .mul("0.72");
    expect(here.toFixed(6)).toBe(sheet.toFixed(6));
    expect(here.toFixed(2)).toBe("38.58");
  });
});
