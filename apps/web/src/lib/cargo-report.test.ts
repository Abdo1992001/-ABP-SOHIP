import { describe, expect, it } from "vitest";
import { containerManifest, reportViews } from "./cargo-report.ts";
import type { LoadedUnit, PackingUnit, Placement } from "./cargo-packing.ts";

/** An ABP 40 ft, as the fleet states it. */
const unit: PackingUnit = {
  innerLengthMm: 11800,
  innerWidthMm: 2100,
  innerHeightMm: 1800,
  doorWidthMm: 2100,
  doorHeightMm: 1800,
  payloadKg: 25000,
};

const at = (extra: Partial<Placement> = {}): Placement => ({
  itemId: "b1",
  label: "ACROW Board 18 mm x 1220 mm x 2440 mm",
  unitIndex: 0,
  x: 0,
  y: 0,
  z: 0,
  lengthMm: 2440,
  widthMm: 1220,
  heightMm: 1000,
  weightKg: 1100,
  rotated: false,
  ...extra,
});

const loadedWith = (placements: Placement[]): LoadedUnit => {
  const weightKg = placements.reduce((sum, p) => sum + p.weightKg, 0);
  return {
    index: 0,
    placements,
    weightKg,
    volumeM3: 30,
    volumeUse: 0.67,
    payloadUse: weightKg / unit.payloadKg,
  };
};

describe("the four views a customer gets", () => {
  const views = reportViews(unit);

  it("gives front, rear, both sides and a plan", () => {
    expect(views.map((view) => view.name)).toEqual([
      "FRONT",
      "REAR",
      "LEFT",
      "RIGHT",
      "PLAN",
    ]);
  });

  it("looks straight down for the plan, from above the roof", () => {
    const plan = views.find((view) => view.name === "PLAN");
    expect(plan?.position[0]).toBe(0);
    expect(plan?.position[2]).toBe(0);
    expect(plan?.position[1]).toBeGreaterThan(1.8);
  });

  it("tells the plan which way up it is, because down cannot", () => {
    // Looking along the world's up, the world's up says nothing about how the
    // picture is turned. Minus Z runs the container across a wide frame.
    const plan = views.find((view) => view.name === "PLAN");
    expect(plan?.up).toEqual([0, 0, -1]);
    for (const view of views.filter((one) => one.name !== "PLAN"))
      expect(view.up).toEqual([0, 1, 0]);
  });

  it("stands square on to a face, never at a corner", () => {
    // One axis carries the whole stand-off and the other is zero: an oblique
    // view cannot be compared with the container in front of you.
    for (const view of views) {
      const [x, , z] = view.position;
      expect(x === 0 || z === 0).toBe(true);
    }
  });

  it("puts the eye at half the container's height", () => {
    for (const view of views.filter((one) => one.name !== "PLAN"))
      expect(view.position[1]).toBeCloseTo(0.9, 6);
  });

  it("stands back far enough to clear the container it is looking into", () => {
    const front = views.find((view) => view.name === "FRONT");
    // Beyond the end wall at 5.9 m, or the camera is inside the load.
    expect(front?.position[0]).toBeGreaterThan(11.8 / 2);
  });

  it("stands back down the container, not just outside its end wall", () => {
    // Clearing the end wall by the 2.8 m that frames it leaves the nearest
    // bundle a couple of metres from the lens, where it fills the picture and
    // runs off the edge. The view has to be a tube, not a close-up.
    const front = views.find((view) => view.name === "FRONT");
    expect(front?.position[0]).toBeCloseTo(11.8 * 0.9, 6);
  });

  it("does not push a short unit further back than it needs", () => {
    // A 4 m Jumbo: nine tenths of its length would not even clear its own end
    // wall, so the framing distance wins instead.
    const jumbo = reportViews({
      ...unit,
      innerLengthMm: 4200,
      innerWidthMm: 2450,
      innerHeightMm: 2400,
    });
    const front = jumbo.find((view) => view.name === "FRONT");
    expect(front?.position[0]).toBeGreaterThan(4.2 / 2);
    expect(front?.position[0]).toBeCloseTo(2.45 * 1.35 + 2.1, 6);
  });

  it("stands further back for a longer unit", () => {
    const trailer = reportViews({ ...unit, innerLengthMm: 13600 });
    const front = views.find((view) => view.name === "FRONT");
    const longer = trailer.find((view) => view.name === "FRONT");
    expect(longer?.position[0]).toBeGreaterThan(front?.position[0] ?? 0);
  });

  it("stands off a side view by more than the container is long", () => {
    // The whole length has to be in frame, and the near wall is the plane
    // where it looks longest, so the distance is taken from there outwards.
    const left = views.find((view) => view.name === "LEFT");
    expect(left?.position[2]).toBeGreaterThan(11.8);
  });

  it("frames a short, tall unit by its height instead", () => {
    // A 4 m Jumbo at 2.4 m: its length would put the camera inside the roof.
    const jumbo = reportViews({
      ...unit,
      innerLengthMm: 4200,
      innerWidthMm: 2450,
      innerHeightMm: 2400,
    });
    const left = jumbo.find((view) => view.name === "LEFT");
    expect(left?.position[2]).toBeCloseTo(2.4 * 2.2 + 1.225, 6);
  });

  it("looks at the middle of the load from every side", () => {
    for (const view of views) expect(view.target).toEqual([0, 0.9, 0]);
  });
});

describe("what one container is carrying", () => {
  it("groups the placements by product, not by piece", () => {
    const manifest = containerManifest(
      loadedWith([
        at(),
        at({ z: 1000 }),
        at({ itemId: "b2", label: "Curved" }),
      ]),
      unit,
      0,
    );
    expect(manifest.rows.length).toBe(2);
    expect(manifest.pieces).toBe(3);
  });

  it("counts the containers the way a customer does, from one", () => {
    expect(containerManifest(loadedWith([at()]), unit, 0).number).toBe(1);
    expect(containerManifest(loadedWith([at()]), unit, 2).number).toBe(3);
  });

  it("keeps a short bundle with the product it belongs to", () => {
    const manifest = containerManifest(
      loadedWith([at(), at({ itemId: "b1~rest", weightKg: 400 })]),
      unit,
      0,
      { groupKey: (itemId) => itemId.replace(/~rest$/, "") },
    );
    expect(manifest.rows.length).toBe(1);
    expect(manifest.rows[0]?.pieces).toBe(2);
    expect(manifest.rows[0]?.weightKg).toBe(1500);
  });

  it("counts the boards inside the pieces when it is told how many", () => {
    const manifest = containerManifest(
      loadedWith([at(), at({ z: 1000 })]),
      unit,
      0,
      {
        boardsIn: () => 35,
      },
    );
    expect(manifest.rows[0]?.boards).toBe(70);
    expect(manifest.boards).toBe(70);
  });

  it("leaves the boards blank rather than guessing", () => {
    const manifest = containerManifest(loadedWith([at()]), unit, 0);
    expect(manifest.rows[0]?.boards).toBeNull();
    expect(manifest.boards).toBeNull();
  });

  it("does not print a partial count as a total", () => {
    // One piece of unknown content makes the row unknown; 35 printed where the
    // true answer is 35 plus something is a number a customer would act on.
    const manifest = containerManifest(
      loadedWith([at(), at({ itemId: "b1", z: 1000 })]),
      unit,
      0,
      { boardsIn: (placement) => (placement.z === 0 ? 35 : null) },
    );
    expect(manifest.rows[0]?.boards).toBeNull();
  });

  it("gives each product its share of the container's weight", () => {
    const manifest = containerManifest(
      loadedWith([at(), at({ itemId: "b2", label: "Curved", weightKg: 300 })]),
      unit,
      0,
    );
    const shares = manifest.rows.map((row) => row.weightShare);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    // Heaviest first, because that is the one that decides the container.
    expect(manifest.rows[0]?.weightKg).toBe(1100);
  });

  it("reports the payload against the container it is actually in", () => {
    const manifest = containerManifest(loadedWith([at()]), unit, 0);
    expect(manifest.payloadUse).toBeCloseTo(1100 / 25000, 9);
  });

  it("says nothing rather than dividing by zero on a payload-less unit", () => {
    const manifest = containerManifest(
      loadedWith([at()]),
      { ...unit, payloadKg: 0 },
      0,
    );
    expect(manifest.payloadUse).toBe(0);
  });
});
