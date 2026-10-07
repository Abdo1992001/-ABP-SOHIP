import { describe, expect, it } from "vitest";
import { demoFrames, loadingOrder } from "./cargo-demo.ts";
import type { LoadedUnit, Placement } from "./cargo-packing.ts";

const at = (
  x: number,
  y: number,
  z: number,
  extra: Partial<Placement> = {},
): Placement => ({
  itemId: "b1",
  label: "ACROW Board 18 mm x 1220 mm x 2440 mm",
  unitIndex: 0,
  x,
  y,
  z,
  lengthMm: 2440,
  widthMm: 1220,
  heightMm: 1000,
  weightKg: 1100,
  rotated: false,
  ...extra,
});

const loadedWith = (placements: Placement[]): LoadedUnit => ({
  index: 0,
  placements,
  weightKg: placements.reduce((sum, piece) => sum + piece.weightKg, 0),
  volumeM3: 20,
  volumeUse: 0.5,
  payloadUse: 0.5,
});

describe("the order a crew loads in", () => {
  it("fills the floor before anything stands on it", () => {
    // The upper bundle is listed first; playing it back in that order would
    // stand a bundle in mid-air and fill the floor in underneath it.
    const order = loadingOrder(
      loadedWith([at(0, 0, 1000), at(2440, 0, 0), at(0, 0, 0)]),
    );
    expect(order.map((piece) => piece.z)).toEqual([0, 0, 1000]);
  });

  it("works from the nose back towards the doors", () => {
    const order = loadingOrder(
      loadedWith([at(4880, 0, 0), at(0, 0, 0), at(2440, 0, 0)]),
    );
    expect(order.map((piece) => piece.x)).toEqual([0, 2440, 4880]);
  });

  it("goes across the row once the depth is settled", () => {
    const order = loadingOrder(loadedWith([at(0, 1220, 0), at(0, 0, 0)]));
    expect(order.map((piece) => piece.y)).toEqual([0, 1220]);
  });

  it("leaves the plan alone", () => {
    const loaded = loadedWith([at(0, 0, 1000), at(0, 0, 0)]);
    loadingOrder(loaded);
    expect(loaded.placements[0]?.z).toBe(1000);
  });
});

describe("what the demo can say at each step", () => {
  const loaded = loadedWith([at(0, 0, 0), at(2440, 0, 0), at(0, 0, 1000)]);

  it("starts empty, so the container can be shown before anything goes in", () => {
    const [first] = demoFrames(loaded);
    expect(first).toMatchObject({ placed: 0, piece: null, weightKg: 0 });
  });

  it("has one frame per piece, plus the empty one", () => {
    expect(demoFrames(loaded).length).toBe(4);
  });

  it("adds the weight up as it goes", () => {
    const frames = demoFrames(loaded);
    expect(frames[3]?.weightKg).toBeCloseTo(3300, 6);
  });

  it("counts layers the way a crew does, from one", () => {
    const frames = demoFrames(loaded);
    expect(frames[1]?.layer).toBe(1);
    expect(frames[2]?.layer).toBe(1);
    expect(frames[3]?.layer).toBe(2);
  });

  it("names the piece that just went in", () => {
    const frames = demoFrames(loaded);
    expect(frames[1]?.piece?.x).toBe(0);
    expect(frames[2]?.piece?.x).toBe(2440);
  });

  it("has one frame for an empty container", () => {
    expect(demoFrames(loadedWith([])).length).toBe(1);
  });
});
