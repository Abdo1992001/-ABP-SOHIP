import { describe, expect, it } from "vitest";
import {
  blockerMessage,
  buildLineDescription,
  computeMaterialClassPreview,
  lineStatus,
  type Line,
  type MaterialClass,
} from "./QuotationStudio.tsx";

/**
 * The studio previews a line before the server ever sees it. If the preview
 * and the server disagree, the price a rep quotes on the phone is not the
 * price on the document — so these assert the same worked example the API's
 * circular-column.test.ts does (spec SS34).
 */
const companyRates: Record<MaterialClass, number> = {
  STANDARD: 90,
  REGULAR: 90,
  CURVED: 120,
  CIRCULAR: 120,
  CORE: 90,
  WALL: 90,
};
const noOverrides = {
  standardPricePerKgOverride: "",
  curvedPricePerKgOverride: "",
  circularPricePerKgOverride: "",
  densityOverrideKgM3: "",
};

function line(overrides: Partial<Line>): Line {
  return {
    description: "",
    qty: "1",
    unitCode: "PCS",
    unitPrice: null,
    discountAmount: "0",
    sectionLabel: "",
    pricingMethodCode: "",
    lengthMm: "",
    widthMm: "",
    thicknessMm: "18",
    densityKgM3: "",
    pricePerKg: "",
    boardTypeLabel: "",
    descriptionAuto: true,
    materialClass: "",
    category: "",
    reference: "",
    cadMark: "",
    diameterMm: "",
    radiusMm: "",
    columnHeightMm: "",
    mouldSegments: "",
    arcModuleMm: "",
    verticalCourseMm: "",
    columnShape: "RECTANGULAR",
    sideAMm: "",
    sideBMm: "",
    faceWidthsMm: [],
    maxPanelWidthMm: "",
    maxPanelLengthMm: "",
    curvedFaceNumbers: [],
    expectedFaces: "",
    columnSideCount: "",
    sideWidthsMm: "",
    arcLengthMm: "",
    arcAngleDeg: "",
    extensionLengthM: "",
    customFormulaKey: "",
    formulaRate: "",
    fabricationCost: "",
    fixedCost: "",
    ...overrides,
  };
}

const circularColumn = line({
  materialClass: "CIRCULAR",
  diameterMm: "1200",
  columnHeightMm: "6000",
  qty: "10",
});

describe("buildLineDescription", () => {
  it("names a standard board thickness x width x length", () => {
    expect(
      buildLineDescription(
        line({ materialClass: "STANDARD", widthMm: "1220", lengthMm: "2440" }),
      ),
    ).toBe("Acrow Board 18 mm \u00d7 1220 mm \u00d7 2440 mm (M Board)");
  });

  it("names a circular column by what is delivered, with the diameter after it", () => {
    expect(buildLineDescription(circularColumn)).toBe(
      "Acrow Board 18 mm \u00d7 1885 mm \u00d7 1200 mm (M Board Curved) (D=1200 mm)",
    );
  });
});

describe("computeMaterialClassPreview", () => {
  it("prices a circular column on the delivered piece, not the mould module", () => {
    const preview = computeMaterialClassPreview(
      circularColumn,
      noOverrides,
      companyRates,
      720,
      18,
    );
    expect(preview).not.toBeNull();
    expect(preview?.pricedQty).toBe(100);
    // 1.885 x 1.2 x 0.018 x 720 = 29.31552 kg, at 120 EGP/kg. The weight is
    // DISPLAYED at three decimals but priced at full precision and rounded
    // once, at the end (spec SS35) -- rounding the weight first would add six
    // piastres a piece, which is 600 EGP across a hundred of them.
    expect(preview?.weightKg).toBeCloseTo(29.3155, 4);
    expect(preview?.unitPrice).toBeCloseTo(3517.86, 2);
    expect(preview?.totalWeightKg).toBeCloseTo(2931.6, 1);
  });

  it("keeps qty x unit price equal to the schedule when a column yields two cut sizes", () => {
    const preview = computeMaterialClassPreview(
      line({
        materialClass: "CIRCULAR",
        diameterMm: "5000",
        columnHeightMm: "1200",
        qty: "1",
      }),
      noOverrides,
      companyRates,
      720,
      18,
    );
    expect(preview?.circular?.pieces).toHaveLength(2);
    expect(preview?.pricedQty).toBe(8);
    const scheduleWeight =
      6 * 2.44 * 1.2 * 0.018 * 720 + 2 * 0.534 * 1.2 * 0.018 * 720;
    expect(preview?.totalWeightKg).toBeCloseTo(scheduleWeight, 2);
  });
});

describe("lineStatus", () => {
  it("is READY once a circular column has everything it needs", () => {
    const ready = {
      ...circularColumn,
      description: buildLineDescription(circularColumn),
    };
    const preview = computeMaterialClassPreview(
      ready,
      noOverrides,
      companyRates,
      720,
      18,
    );
    expect(lineStatus(ready, preview, noOverrides, companyRates, 720, 18)).toBe(
      "READY",
    );
  });

  it("asks for a diameter before it prices anything", () => {
    const missing = { ...circularColumn, diameterMm: "", description: "x" };
    const preview = computeMaterialClassPreview(
      missing,
      noOverrides,
      companyRates,
      720,
      18,
    );
    expect(
      lineStatus(missing, preview, noOverrides, companyRates, 720, 18),
    ).toBe("ENTER_DIAMETER_OR_RADIUS");
  });
});

describe("circular rate hierarchy", () => {
  const rateOf = (header: typeof noOverrides): number =>
    computeMaterialClassPreview(circularColumn, header, companyRates, 720, 18)
      ?.unitPrice ?? 0;

  it("uses the company circular default when nothing is overridden", () => {
    // 29.31552 kg at the company's 120 EGP/kg.
    expect(rateOf(noOverrides)).toBeCloseTo(3517.86, 2);
  });

  it("falls back to the curved override when no circular one is set", () => {
    expect(
      rateOf({ ...noOverrides, curvedPricePerKgOverride: "100" }),
    ).toBeCloseTo(2931.55, 2);
  });

  it("prefers its own override, so discounting curved work leaves it alone", () => {
    expect(
      rateOf({
        ...noOverrides,
        curvedPricePerKgOverride: "100",
        circularPricePerKgOverride: "115",
      }),
    ).toBeCloseTo(3371.28, 2);
  });
});

describe("stored pricing rules", () => {
  const formulas = [
    {
      formulaKey: "price_by_area",
      displayName: "Price by area",
      expression: "area * rate",
      rateUnitLabel: "per m²",
    },
    {
      formulaKey: "weight_plus_fabrication",
      displayName: "Weight plus fabrication",
      expression: "weight * rate + fabricationCost",
      rateUnitLabel: "per kg",
    },
    {
      formulaKey: "broken",
      displayName: "Broken",
      expression: "area * markup",
    },
  ];

  const board = line({
    materialClass: "STANDARD",
    widthMm: "1220",
    lengthMm: "2440",
    qty: "10",
    description: "board",
  });

  it("prices by the rule instead of by the kilogram", () => {
    // 1.22 x 2.44 = 2.9768 m² at 250 per m².
    const preview = computeMaterialClassPreview(
      { ...board, customFormulaKey: "price_by_area", formulaRate: "250" },
      noOverrides,
      companyRates,
      720,
      18,
      formulas,
    );
    expect(preview?.unitPrice).toBeCloseTo(744.2, 2);
    expect(preview?.formulaError).toBe(false);
  });

  it("reads the extra inputs a rule asks for", () => {
    const preview = computeMaterialClassPreview(
      {
        ...board,
        customFormulaKey: "weight_plus_fabrication",
        formulaRate: "90",
        fabricationCost: "150",
      },
      noOverrides,
      companyRates,
      720,
      18,
      formulas,
    );
    // 38.579328 kg x 90 + 150.
    expect(preview?.unitPrice).toBeCloseTo(3622.14, 2);
  });

  it("falls back to the resolved class rate when none is typed", () => {
    const preview = computeMaterialClassPreview(
      { ...board, customFormulaKey: "weight_plus_fabrication" },
      noOverrides,
      companyRates,
      720,
      18,
      formulas,
    );
    // The company STANDARD rate of 90, with no fabrication charge.
    expect(preview?.unitPrice).toBeCloseTo(3472.14, 2);
  });

  it("prices nothing and reports CHECK_FORMULA when a rule will not evaluate", () => {
    const broken = { ...board, customFormulaKey: "broken" };
    const preview = computeMaterialClassPreview(
      broken,
      noOverrides,
      companyRates,
      720,
      18,
      formulas,
    );
    expect(preview?.formulaError).toBe(true);
    expect(preview?.unitPrice).toBe(0);
    expect(
      lineStatus(broken, preview, noOverrides, companyRates, 720, 18),
    ).toBe("CHECK_FORMULA");
  });
});

/**
 * The workbook's REGULAR COLUMNS quotation, reproduced end to end: its master
 * settings (600 kg/m3, a 2,500 EGP reference board), its face rule
 * (A / B / A+20 / B+20) and the unit price it prints.
 */
describe("regular columns", () => {
  const workbookRates: Record<MaterialClass, number> = {
    ...companyRates,
    STANDARD: 77.76185215,
    REGULAR: 77.76185215,
    CORE: 77.76185215,
    WALL: 77.76185215,
  };

  const column = (overrides: Partial<Line>) =>
    line({
      materialClass: "REGULAR",
      columnShape: "RECTANGULAR",
      sideAMm: "300",
      sideBMm: "300",
      columnHeightMm: "4000",
      qty: "2",
      ...overrides,
    });

  it("laps the two closing panels (COL-001: 300 x 300 -> 300|300|320|320)", () => {
    const preview = computeMaterialClassPreview(
      column({}),
      noOverrides,
      workbookRates,
      600,
      18,
    );
    expect(preview?.column?.faceWidthsMm).toEqual([300, 300, 320, 320]);
    expect(preview?.column?.totalFaceWidthMm).toBe(1240);
  });

  it("splits a 4 m column into two 2 m lifts", () => {
    const preview = computeMaterialClassPreview(
      column({}),
      noOverrides,
      workbookRates,
      600,
      18,
    );
    expect(preview?.column?.verticalCourses).toBe(2);
    // 4 faces x 2 lifts x 2 columns.
    expect(preview?.pricedQty).toBe(16);
  });

  it("prices the workbook's own 200 x 2000 panel at 335.93", () => {
    const preview = computeMaterialClassPreview(
      column({
        columnShape: "IRREGULAR",
        faceWidthsMm: ["200", "200", "200", "200"],
        qty: "1",
        columnHeightMm: "2000",
      }),
      noOverrides,
      workbookRates,
      600,
      18,
    );
    // 0.2 x 2.0 x 0.018 x 600 = 4.32 kg, at 2,500 / 32.14944 EGP per kg.
    expect(preview?.weightKg).toBeCloseTo(4.32, 3);
    expect(preview?.unitPrice).toBeCloseTo(335.93, 2);
  });

  it("names the delivered panel, not the column", () => {
    expect(
      buildLineDescription(
        column({
          columnShape: "IRREGULAR",
          faceWidthsMm: ["200"],
          qty: "1",
          columnHeightMm: "2000",
        }),
      ),
    ).toBe("Acrow Board 18 mm × 200 mm × 2000 mm (M Board)");
  });

  it("flags a column that delivers more than one panel size", () => {
    expect(buildLineDescription(column({}))).toContain("(+1 size)");
  });

  it("asks for both dimensions before it prices anything", () => {
    const bare = column({ sideBMm: "", description: "x" });
    const preview = computeMaterialClassPreview(
      bare,
      noOverrides,
      workbookRates,
      600,
      18,
    );
    expect(preview?.pricedQty).toBe(0);
    expect(lineStatus(bare, preview, noOverrides, workbookRates, 600, 18)).toBe(
      "CHECK_DIMENSIONS",
    );
  });

  it("accepts the finished panel dimensions derived from a regular column", () => {
    const geometry = column({ sideAMm: "600", sideBMm: "400" });
    const ready = { ...geometry, description: buildLineDescription(geometry) };
    const preview = computeMaterialClassPreview(
      ready,
      noOverrides,
      workbookRates,
      600,
      18,
    );

    expect(ready.widthMm).toBe("");
    expect(ready.lengthMm).toBe("");
    expect(preview?.column?.panels[0]?.widthMm).toBeGreaterThan(0);
    expect(preview?.column?.panels[0]?.lengthMm).toBe(2000);
    expect(
      lineStatus(ready, preview, noOverrides, workbookRates, 600, 18),
    ).toBe("READY");
  });
});

/**
 * A core and a wall are the same face engine on a bigger drawing, with one
 * rule of their own: a face the drawing marks as curved is charged as curved
 * work even though the rest of the element is flat.
 */
describe("cores and walls", () => {
  const core = (overrides: Partial<Line>) =>
    line({
      materialClass: "CORE",
      faceWidthsMm: ["600", "600", "600", "600"],
      columnHeightMm: "2000",
      qty: "1",
      ...overrides,
    });

  it("takes its faces off the drawing, twenty of them if need be", () => {
    const twenty = Array.from({ length: 20 }, () => "500");
    const preview = computeMaterialClassPreview(
      core({ faceWidthsMm: twenty }),
      noOverrides,
      companyRates,
      600,
      18,
    );
    expect(preview?.column?.facesPerColumn).toBe(20);
    expect(preview?.pricedQty).toBe(20);
  });

  it("blocks review when the drawing's expected face count is incomplete", () => {
    const incomplete = core({
      description: "Four-face core",
      faceWidthsMm: ["600", "600", "600"],
      expectedFaces: "4",
    });
    const preview = computeMaterialClassPreview(
      incomplete,
      noOverrides,
      companyRates,
      600,
      18,
    );

    expect(
      lineStatus(incomplete, preview, noOverrides, companyRates, 600, 18),
    ).toBe("CHECK_INPUT");
  });

  it("charges a curved face at the curved rate and the rest at the flat one", () => {
    const flat = computeMaterialClassPreview(
      core({}),
      noOverrides,
      companyRates,
      600,
      18,
    );
    const withCurve = computeMaterialClassPreview(
      core({ curvedFaceNumbers: [4] }),
      noOverrides,
      companyRates,
      600,
      18,
    );
    // Same steel, same panels — but one of the four now costs curved money,
    // so the line is dearer without the quantity moving.
    expect(withCurve?.pricedQty).toBe(flat?.pricedQty);
    expect(withCurve?.unitPrice).toBeGreaterThan(flat?.unitPrice ?? 0);
    expect(withCurve?.column?.curvedFaceCount).toBe(1);
  });

  it("keeps a curved panel as its own group, not merged with its flat twin", () => {
    const preview = computeMaterialClassPreview(
      core({ faceWidthsMm: ["600", "600"], curvedFaceNumbers: [2] }),
      noOverrides,
      companyRates,
      600,
      18,
    );
    expect(preview?.column?.panels).toHaveLength(2);
  });

  it("says so when a face is missing from the drawing", () => {
    const preview = computeMaterialClassPreview(
      core({ expectedFaces: "5" }),
      noOverrides,
      companyRates,
      600,
      18,
    );
    expect(preview?.column?.notes.join(" ")).toContain("expected to have 5");
  });

  it("still prices a wall saved before the face engine existed", () => {
    // No faces entered: it falls back to the plain panel it was saved with.
    const preview = computeMaterialClassPreview(
      line({
        materialClass: "WALL",
        widthMm: "1220",
        lengthMm: "2440",
        qty: "3",
      }),
      noOverrides,
      companyRates,
      600,
      18,
    );
    expect(preview?.column).toBeNull();
    expect(preview?.pricedQty).toBe(3);
    expect(preview?.unitPrice).toBeGreaterThan(0);
  });
});

describe("blockerMessage", () => {
  it("reads out a flagged line instead of its i18n key", () => {
    expect(
      blockerMessage("LINE_CHECK_PRICE", "errors.line_check_price", "en"),
    ).toBe("A line needs checking: Check price");
  });

  it("explains a total that does not follow from its lines", () => {
    expect(
      blockerMessage(
        "RECONCILIATION_GRAND_TOTAL",
        "errors.reconciliation_grand_total",
        "en",
      ),
    ).toContain("does not follow from the lines");
  });

  it("leaves blockers it does not own alone", () => {
    expect(
      blockerMessage("PRICE_BELOW_MINIMUM", "errors.price_below_minimum", "en"),
    ).toBe("errors.price_below_minimum");
  });
});
