import { describe, expect, it } from "vitest";
import {
  packCargo,
  type CargoItem,
  type PackingUnit,
} from "./cargo-packing.ts";

/**
 * A load plan is only worth the arithmetic behind it. These check the four
 * things that decide whether a plan survives contact with a quay: nothing
 * overlaps, nothing leaves the box, weight closes a unit before volume does,
 * and a piece that cannot go in says why rather than disappearing.
 */

const UNIT: PackingUnit = {
  innerLengthMm: 12032,
  innerWidthMm: 2352,
  innerHeightMm: 2393,
  doorWidthMm: 2340,
  doorHeightMm: 2280,
  payloadKg: 26680,
};

/** A bundle of ACROW panels: flat, banded, heavy for its size. */
const bundle = (over: Partial<CargoItem> = {}): CargoItem => ({
  id: "B1",
  label: "Standard 1220×2440 bundle",
  lengthMm: 2440,
  widthMm: 1220,
  heightMm: 360,
  weightKg: 520,
  quantity: 1,
  ...over,
});

/** Do any two placements in the same unit share space? */
function overlaps(
  a: {
    x: number;
    y: number;
    z: number;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  },
  b: typeof a,
) {
  const apart =
    a.x + a.lengthMm <= b.x ||
    b.x + b.lengthMm <= a.x ||
    a.y + a.widthMm <= b.y ||
    b.y + b.widthMm <= a.y ||
    a.z + a.heightMm <= b.z ||
    b.z + b.heightMm <= a.z;
  return !apart;
}

describe("cargo packing", () => {
  it("places every piece inside the unit, and none on top of another", () => {
    const result = packCargo([bundle({ quantity: 40 })], UNIT);

    expect(result.placedPieces).toBeGreaterThan(0);
    for (const unit of result.units) {
      for (const p of unit.placements) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.x + p.lengthMm).toBeLessThanOrEqual(UNIT.innerLengthMm);
        expect(p.y + p.widthMm).toBeLessThanOrEqual(UNIT.innerWidthMm);
        expect(p.z + p.heightMm).toBeLessThanOrEqual(UNIT.innerHeightMm);
      }
      for (let i = 0; i < unit.placements.length; i += 1) {
        for (let j = i + 1; j < unit.placements.length; j += 1) {
          const a = unit.placements[i];
          const b = unit.placements[j];
          if (a === undefined || b === undefined) continue;
          expect(overlaps(a, b)).toBe(false);
        }
      }
    }
  });

  it("closes a container on weight while it still has room in it", () => {
    // Geometry alone puts 24 of these bundles in a 40ft box — 4 along the
    // length, 1 across the width, 6 layers high. At 1,200kg each that is
    // 28,800kg against a 26,680kg payload, so weight has to stop it first.
    const heavy = bundle({ weightKg: 1200, quantity: 24 });
    const result = packCargo([heavy], UNIT);

    expect(result.units.length).toBeGreaterThanOrEqual(2);
    for (const unit of result.units) {
      expect(unit.weightKg).toBeLessThanOrEqual(UNIT.payloadKg);
    }
    const first = result.units[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      // Full by weight, with space still in it — which is the normal case for
      // panel cargo and the reason volume alone never decides the unit count.
      expect(first.payloadUse).toBeGreaterThan(0.95);
      expect(first.volumeUse).toBeLessThan(first.payloadUse);
    }
  });

  it("fills a 40ft box with 24 standard bundles, and says so", () => {
    // The geometry stated above, asserted rather than assumed: if the packer
    // ever starts producing 20 or 30 for this input, something changed in it
    // that nobody decided.
    const result = packCargo([bundle({ quantity: 24 })], UNIT);

    expect(result.units).toHaveLength(1);
    expect(result.placedPieces).toBe(24);
  });

  it("loads everything when it fits, and accounts for every piece", () => {
    const result = packCargo([bundle({ quantity: 12 })], UNIT);

    expect(result.totalPieces).toBe(12);
    expect(result.placedPieces).toBe(12);
    expect(result.refused).toEqual([]);
    expect(result.units).toHaveLength(1);
  });

  it("refuses a bundle longer than the box, and names the reason", () => {
    const result = packCargo(
      [bundle({ id: "LONG", lengthMm: 13000, widthMm: 1200, quantity: 3 })],
      UNIT,
    );

    expect(result.placedPieces).toBe(0);
    expect(result.refused).toEqual([
      expect.objectContaining({
        itemId: "LONG",
        reason: "TOO_LONG",
        quantity: 3,
      }),
    ]);
  });

  it("refuses a bundle that fits the box but not the doors", () => {
    // 2,350mm wide clears the 2,352mm interior and not the 2,340mm opening.
    const result = packCargo(
      [
        bundle({
          id: "WIDE",
          lengthMm: 2350,
          widthMm: 2350,
          heightMm: 300,
          rotatable: false,
          quantity: 1,
        }),
      ],
      UNIT,
    );

    expect(result.refused[0]?.reason).toBe("DOOR_TOO_SMALL");
  });

  it("loads a unit with no doors from above, refusing nothing", () => {
    // A flatbed or an open trailer loads over the side, so the door check
    // does not apply. The behaviour belongs to the packer, so the unit is
    // built here rather than looked up: the fleet catalogue changes with the
    // vehicles the company runs, and this rule does not.
    const openTop = {
      innerLengthMm: 12000,
      innerWidthMm: 2480,
      innerHeightMm: 2600,
      doorWidthMm: null,
      doorHeightMm: null,
      payloadKg: 24000,
    };
    const result = packCargo(
      [
        bundle({
          id: "WIDE",
          lengthMm: 2400,
          widthMm: 2400,
          heightMm: 300,
          quantity: 1,
        }),
      ],
      openTop,
    );

    expect(result.refused).toEqual([]);
    expect(result.placedPieces).toBe(1);
  });

  it("turns a bundle when turning it is what makes it fit", () => {
    // 2,300mm across the 2,352mm width only works the other way round.
    const result = packCargo(
      [bundle({ id: "TURN", lengthMm: 1000, widthMm: 2300, quantity: 1 })],
      UNIT,
    );

    expect(result.placedPieces).toBe(1);
    expect(result.units[0]?.placements[0]?.rotated).toBe(true);
  });

  it("gives the same plan for the same input", () => {
    const items = [
      bundle({ id: "A", quantity: 7 }),
      bundle({
        id: "B",
        lengthMm: 1800,
        widthMm: 900,
        weightKg: 300,
        quantity: 9,
      }),
    ];
    const first = packCargo(items, UNIT);
    const second = packCargo(items, UNIT);

    expect(JSON.stringify(second.units)).toBe(JSON.stringify(first.units));
  });

  it("does not stack a different product on a smaller footprint", () => {
    const result = packCargo(
      [
        bundle({ id: "A", heightMm: 800, quantity: 1 }),
        bundle({
          id: "B",
          lengthMm: 2000,
          widthMm: 800,
          heightMm: 400,
          quantity: 1,
        }),
      ],
      UNIT,
    );
    const smaller = result.units[0]?.placements.find(
      (one) => one.itemId === "B",
    );
    expect(smaller?.z).toBe(0);
  });

  it("keeps a short remainder on top of its own full bundle", () => {
    const result = packCargo(
      [
        bundle({ id: "A", heightMm: 800, quantity: 1 }),
        bundle({ id: "A~rest", heightMm: 400, quantity: 1 }),
      ],
      UNIT,
    );
    const remainder = result.units[0]?.placements.find(
      (one) => one.itemId === "A~rest",
    );
    expect(remainder).toMatchObject({ x: 0, y: 0, z: 800 });
  });

  it("reports one refusal per item, not one per piece", () => {
    const result = packCargo(
      [bundle({ id: "TALL", heightMm: 3000, quantity: 25 })],
      UNIT,
    );

    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.quantity).toBe(25);
    expect(result.refused[0]?.reason).toBe("TOO_TALL");
  });
});
