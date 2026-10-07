import { describe, expect, it } from "vitest";
import { bundleLine, DEFAULT_BUNDLING } from "./cargo-bundling.ts";
import { CARGO_CONTAINERS } from "./cargo-containers.ts";
import {
  cargoItems,
  fitBundling,
  fleetSummary,
  packFleet,
  type FleetUnit,
} from "./cargo-load.ts";
import { packCargo, type Placement } from "./cargo-packing.ts";

const unitOf = (code: string): FleetUnit => {
  const c = CARGO_CONTAINERS.find((one) => one.code === code);
  if (c === undefined) throw new Error(code);
  return {
    code,
    unit: {
      innerLengthMm: c.innerLengthMm,
      innerWidthMm: c.innerWidthMm,
      innerHeightMm: c.innerHeightMm,
      doorWidthMm: c.doorWidthMm,
      doorHeightMm: c.doorHeightMm,
      payloadKg: c.payloadKg,
    },
  };
};
const FORTY = unitOf("ABP40");
const TWENTY = unitOf("ABP20");

/** The fourteen board sizes of a real ten-line quotation: 5,338 boards. */
const ORDER: [number, number, number, number, number][] = [
  [18, 1220, 2440, 1200, 600],
  [15, 883, 2983, 850, 600],
  [15, 733, 2983, 640, 600],
  [15, 583, 2983, 520, 600],
  [15, 883, 1183, 900, 650],
  [18, 582, 2982, 460, 600],
  [21, 1220, 2440, 300, 600],
  [18, 1571, 1200, 180, 600],
  [18, 620, 2000, 48, 600],
  [18, 600, 2000, 48, 600],
  [18, 420, 2000, 48, 600],
  [18, 400, 2000, 48, 600],
  [18, 1571, 1200, 64, 600],
  [18, 1571, 600, 32, 600],
];

function bundlesOf(
  bundling = fitBundling(DEFAULT_BUNDLING, FORTY.unit.innerHeightMm),
) {
  const groups = ORDER.map(([t, w, l, q, d], i) =>
    bundleLine(
      {
        id: `L${String(i)}`,
        description: `${String(t)} x ${String(w)} x ${String(l)}`,
        thicknessMm: t,
        widthMm: w,
        lengthMm: l,
        densityKgM3: d,
        unitWeightKg: (t / 1000) * (w / 1000) * (l / 1000) * d,
        quantity: q,
      },
      bundling,
    ),
  );
  return cargoItems(groups, bundling, "BUNDLES");
}

const clash = (a: Placement, b: Placement) =>
  !(
    a.x + a.lengthMm <= b.x ||
    b.x + b.lengthMm <= a.x ||
    a.y + a.widthMm <= b.y ||
    b.y + b.widthMm <= a.y ||
    a.z + a.heightMm <= b.z ||
    b.z + b.heightMm <= a.z
  );

describe("fitting bundles to the box", () => {
  it("caps a bundle at what stacks in whole layers", () => {
    // 1,800 mm of box and up to 1,100 mm a bundle: two layers of 900.
    expect(fitBundling(DEFAULT_BUNDLING, 1800).maxBundleHeightMm).toBe(900);
  });
  it("never raises the setting", () => {
    expect(
      fitBundling({ ...DEFAULT_BUNDLING, maxBundleHeightMm: 600 }, 1800)
        .maxBundleHeightMm,
    ).toBe(600);
  });
  it("stacks 15 mm bundles two high, which 1,100 mm did not allow", () => {
    const fitted = fitBundling(DEFAULT_BUNDLING, 1800);
    const group = bundleLine(
      {
        id: "t15",
        description: "15 x 883 x 2983",
        thicknessMm: 15,
        widthMm: 883,
        lengthMm: 2983,
        densityKgM3: 600,
        unitWeightKg: 0.015 * 0.883 * 2.983 * 600,
        quantity: 200,
      },
      fitted,
    );
    expect(group.fullBundleHeightMm * 2).toBeLessThanOrEqual(1800);
    expect(
      bundleLine(
        {
          id: "t15",
          description: "15 x 883 x 2983",
          thicknessMm: 15,
          widthMm: 883,
          lengthMm: 2983,
          densityKgM3: 600,
          unitWeightKg: 0.015 * 0.883 * 2.983 * 600,
          quantity: 200,
        },
        DEFAULT_BUNDLING,
      ).fullBundleHeightMm * 2,
    ).toBeGreaterThan(1800);
  });
});

describe("filling the width", () => {
  it("puts a narrow bundle beside a 1220 one instead of leaving the strip empty", () => {
    const result = packCargo(
      [
        {
          id: "wide",
          label: "1220",
          lengthMm: 2440,
          widthMm: 1220,
          heightMm: 850,
          weightKg: 1400,
          quantity: 8,
        },
        {
          id: "narrow",
          label: "733",
          lengthMm: 2440,
          widthMm: 733,
          heightMm: 850,
          weightKg: 900,
          quantity: 8,
        },
      ],
      FORTY.unit,
    );
    expect(result.units).toHaveLength(1);
    const first = result.units[0]?.placements ?? [];
    const floorRow = first.filter((p) => p.x === 0 && p.z === 0);
    expect(floorRow.map((p) => p.itemId).sort()).toEqual(["narrow", "wide"]);
  });
});

describe("the real order", () => {
  const items = bundlesOf();
  const total = items.reduce((sum, item) => sum + item.quantity, 0);

  it("loads every bundle, inside the box, nothing overlapping, within payload", () => {
    const plan = packFleet(items, FORTY, null);
    expect(plan.refused).toEqual([]);
    expect(plan.placedPieces).toBe(total);
    for (const loaded of plan.units) {
      expect(loaded.weightKg).toBeLessThanOrEqual(FORTY.unit.payloadKg);
      for (const p of loaded.placements) {
        expect(p.x + p.lengthMm).toBeLessThanOrEqual(FORTY.unit.innerLengthMm);
        expect(p.y + p.widthMm).toBeLessThanOrEqual(FORTY.unit.innerWidthMm);
        expect(p.z + p.heightMm).toBeLessThanOrEqual(FORTY.unit.innerHeightMm);
      }
      loaded.placements.forEach((a, i) => {
        loaded.placements.slice(i + 1).forEach((b) => {
          expect(clash(a, b)).toBe(false);
        });
      });
    }
  });

  it("books far fewer forties than one size at a time did (13)", () => {
    expect(packFleet(items, FORTY, null).units.length).toBeLessThanOrEqual(8);
  });

  it("returns a genuine mix when the tail needs more than one twenty", () => {
    const mix = packFleet(items, FORTY, TWENTY);
    const forties = packFleet(items, FORTY, null);
    expect(mix.units).toHaveLength(forties.units.length + 1);
    expect(mix.units.filter((u) => u.containerCode === "ABP40")).toHaveLength(
      7,
    );
    expect(mix.units.filter((u) => u.containerCode === "ABP20")).toHaveLength(
      2,
    );
    expect(
      mix.units
        .filter((u) => u.containerCode === "ABP20")
        .every((u) => u.unit.innerLengthMm === TWENTY.unit.innerLengthMm),
    ).toBe(true);
    expect(
      mix.units.every((u) =>
        u.placements.every((placement) => placement.unitIndex === u.index),
      ),
    ).toBe(true);
    expect(mix.placedPieces).toBe(total);
    expect(fleetSummary(mix.units, (code) => code)).toBe(
      "7 × ABP40 + 2 × ABP20",
    );
  });

  it("shows one forty plus two twenties when that is the valid mix", () => {
    const heavy = [
      {
        id: "h",
        label: "h",
        lengthMm: 2440,
        widthMm: 1220,
        heightMm: 850,
        weightKg: 3000,
        quantity: 16,
      },
    ];
    // 48 t: one forty carries half, and the remainder needs two twenties
    // because a twenty has only four supported positions for this footprint.
    const mix = packFleet(heavy, FORTY, TWENTY);
    expect(fleetSummary(mix.units, (code) => code)).toBe(
      "1 × ABP40 + 2 × ABP20",
    );
    expect(mix.placedPieces).toBe(16);
    expect(mix.units.every((unit) => unit.payloadUse <= 1)).toBe(true);
  });
});
