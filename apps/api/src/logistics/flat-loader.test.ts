import { describe, expect, it } from "vitest";
import { planFlatOnFace, validatePlacements } from "./flat-loader.js";
describe("Flat-on-Face logistics", () => {
  it("packs deterministically with only 0/90 and no overlap", () => {
    const lines = [
      {
        id: "a",
        qty: 6,
        length: 2000,
        width: 1000,
        thickness: 100,
        weight: 500,
      },
    ];
    const units = [
      { id: "u", length: 6000, width: 2400, height: 2600, maxWeight: 25000 },
    ];
    const a = planFlatOnFace(lines, units),
      b = planFlatOnFace(lines, units);
    expect(a).toEqual(b);
    expect(a.remaining).toBe(0);
    expect(
      a.placements.every((p) => p.rotation === 0 || p.rotation === 90),
    ).toBe(true);
    expect(validatePlacements(a.placements, units)).toEqual([]);
  });
  it("reports residual demand without inventing another vehicle", () => {
    const r = planFlatOnFace(
      [
        {
          id: "a",
          qty: 1000,
          length: 3000,
          width: 2000,
          thickness: 100,
          weight: 100,
        },
      ],
      [{ id: "u", length: 6000, width: 2400, height: 100, maxWeight: 1000 }],
    );
    expect(r.remaining).toBeGreaterThan(0);
  });
});
