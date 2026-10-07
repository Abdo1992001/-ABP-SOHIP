import { describe, expect, it } from "vitest";
import { labelFaces } from "./cargo-labels.ts";
import type { Placement } from "./cargo-packing.ts";

/**
 * A bundle of ACROW board, placed. The numbers are a real one: 2,440 long,
 * 1,220 across, a metre high once banded.
 */
const at = (
  x: number,
  y: number,
  z: number,
  extra: Partial<Placement> = {},
): Placement => ({
  itemId: "b1",
  label: "ACROW Board 18mm x 1220 mm x 2440 mm (M- Board)",
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

/** The four upright faces; the top is counted separately where it matters. */
const sidesOf = (faces: ReturnType<typeof labelFaces>) =>
  faces.filter((face) => face.facing !== "TOP");

describe("one marking per stack", () => {
  it("writes the description once for a column, not once per bundle", () => {
    const faces = labelFaces([at(0, 0, 0), at(0, 0, 1000), at(0, 0, 2000)]);
    // Four sides and a top, of one stack rather than of three bundles.
    expect(faces.length).toBe(5);
    expect(sidesOf(faces).length).toBe(4);
  });

  it("makes the marking as tall as the whole stack", () => {
    const faces = labelFaces([at(0, 0, 0), at(0, 0, 1000)]);
    // The sides run the full height of the stack; the top is measured across
    // the footprint instead, which is a different number by design.
    for (const face of sidesOf(faces)) expect(face.faceHeightMm).toBe(2000);
  });

  it("keeps two footprints apart", () => {
    // Side by side across the container, so each is marked on its own faces —
    // all but the two they press together.
    const faces = labelFaces([at(0, 0, 0), at(0, 1220, 0)]);
    expect(sidesOf(faces).length).toBe(6);
    const stacks = new Set(faces.map((face) => face.centreYMm));
    expect(stacks.size).toBeGreaterThan(1);
  });

  it("splits a footprint with air in the middle into two stacks", () => {
    // Nothing at 1000–1400: the upper bundle is its own stack, and a single
    // label spanning the gap would hang over nothing.
    const faces = labelFaces([at(0, 0, 0), at(0, 0, 1400)]);
    expect(sidesOf(faces).length).toBe(8);
    for (const face of sidesOf(faces)) expect(face.faceHeightMm).toBe(1000);
  });

  it("treats a short bundle on top of full ones as the same stack", () => {
    const faces = labelFaces(
      [at(0, 0, 0), at(0, 0, 1000, { itemId: "b1~rest", heightMm: 400 })],
      { groupKey: (itemId) => itemId.replace(/~rest$/, "") },
    );
    expect(sidesOf(faces).length).toBe(4);
    for (const face of sidesOf(faces)) expect(face.faceHeightMm).toBe(1400);
  });

  it("keeps a different product in the same footprint separate", () => {
    const faces = labelFaces([
      at(0, 0, 0),
      at(0, 0, 1000, { itemId: "b2", label: "ACROW Board 21mm" }),
    ]);
    expect(sidesOf(faces).length).toBe(8);
  });
});

describe("one marking per physical bundle", () => {
  it("marks every bundle even when identical bundles are stacked", () => {
    const bottom = at(0, 0, 0);
    const middle = at(0, 0, 1000);
    const top = at(0, 0, 2000);
    const faces = labelFaces([bottom, middle, top], { onePerBundle: true });

    expect(
      sidesOf(faces).filter((face) => face.placement === bottom),
    ).toHaveLength(4);
    expect(
      sidesOf(faces).filter((face) => face.placement === middle),
    ).toHaveLength(4);
    expect(
      sidesOf(faces).filter((face) => face.placement === top),
    ).toHaveLength(4);
    expect(faces.filter((face) => face.facing === "TOP")).toHaveLength(1);
    expect(faces.find((face) => face.facing === "TOP")?.placement).toBe(top);
  });
});

describe("only faces something can see", () => {
  it("leaves the face a neighbouring stack is pressed against unmarked", () => {
    // Two bundles end to end down the container: the touching ends carry no
    // marking, because a tag drawn there sits inside the next bundle.
    const faces = labelFaces([at(0, 0, 0), at(2440, 0, 0, { itemId: "b2" })]);
    const first = faces.filter((face) => face.placement.itemId === "b1");
    expect(first.map((face) => face.facing)).not.toContain("LENGTH_PLUS");
    const second = faces.filter((face) => face.placement.itemId === "b2");
    expect(second.map((face) => face.facing)).not.toContain("LENGTH_MINUS");
    // The outward ends and both long sides still are.
    expect(first.map((face) => face.facing)).toContain("LENGTH_MINUS");
    expect(first.map((face) => face.facing)).toContain("WIDTH_PLUS");
  });

  it("marks a face whose neighbour only clips a corner of it", () => {
    // The neighbour abuts the far end of the face but stops well short of the
    // tag in the middle of it, so the marking is visible and is drawn.
    const faces = labelFaces([
      at(0, 0, 0),
      at(2440, 0, 1600, { itemId: "b2", heightMm: 400 }),
    ]);
    const first = faces.filter((face) => face.placement.itemId === "b1");
    expect(first.map((face) => face.facing)).toContain("LENGTH_PLUS");
  });

  it("marks a face with only air against it", () => {
    const faces = labelFaces([at(0, 0, 0), at(0, 4000, 0, { itemId: "b2" })]);
    expect(sidesOf(faces).length).toBe(8);
  });
});

describe("how big the marking is", () => {
  it("keeps the tag inside the face it is printed on", () => {
    for (const face of labelFaces([at(0, 0, 0)])) {
      expect(face.tagWidthMm).toBeLessThanOrEqual(face.faceWidthMm);
      expect(face.tagHeightMm).toBeLessThanOrEqual(face.faceHeightMm);
      expect(face.tagWidthMm / face.tagHeightMm).toBeCloseTo(2, 6);
    }
  });

  it("lets the narrow face, not the tall one, set the size on a long stack", () => {
    const [face] = sidesOf(labelFaces([at(0, 0, 0, { heightMm: 1800 })]));
    // A 2,440 x 1,800 face: 46% of the height would be 828 mm, and 84% of the
    // width over the aspect is 1,024 — the height is what binds.
    expect(face?.tagHeightMm).toBeCloseTo(828, 6);
  });
});

describe("only faces that can be read", () => {
  it("leaves the edges of a loose board unmarked", () => {
    // An 18 mm edge cannot carry text, and shrinking it to fit is a smudge.
    // Its face-up side is 2,440 x 1,220 and reads perfectly well, so that is
    // the one marking a single board gets.
    const faces = labelFaces([at(0, 0, 0, { heightMm: 18 })]);
    expect(sidesOf(faces)).toEqual([]);
    expect(faces.map((face) => face.facing)).toEqual(["TOP"]);
  });

  it("marks the stack those loose boards make", () => {
    const boards = Array.from({ length: 20 }, (_, index) =>
      at(0, 0, index * 18, { heightMm: 18 }),
    );
    const faces = labelFaces(boards);
    expect(sidesOf(faces).length).toBe(4);
    expect(sidesOf(faces)[0]?.faceHeightMm).toBe(360);
  });

  it("skips a face too narrow for the text, keeping the wide ones", () => {
    // A 2,440 × 100 footprint: the long sides read, the 100 mm ends leave room
    // for a tag 42 mm tall, which is not a marking.
    const faces = labelFaces([at(0, 0, 0, { widthMm: 100 })]);
    expect(
      sidesOf(faces)
        .map((face) => face.facing)
        .sort(),
    ).toEqual(["WIDTH_MINUS", "WIDTH_PLUS"]);
  });

  it("marks a narrow end that can still carry a small tag", () => {
    const faces = labelFaces([at(0, 0, 0, { widthMm: 200 })]);
    const end = faces.find((face) => face.facing === "LENGTH_PLUS");
    expect(end?.tagHeightMm).toBeCloseTo(84, 6);
    expect(end?.tagWidthMm).toBeLessThanOrEqual(200);
  });
});

describe("where each face sits", () => {
  const faces = labelFaces([at(1000, 500, 0)]);
  const facing = (name: string) => faces.find((face) => face.facing === name);

  it("centres the long faces on the stack and puts them on its sides", () => {
    expect(facing("WIDTH_PLUS")).toMatchObject({
      centreXMm: 1000 + 1220,
      centreYMm: 500 + 1220,
      centreZMm: 500,
      faceWidthMm: 2440,
    });
    expect(facing("WIDTH_MINUS")?.centreYMm).toBe(500);
  });

  it("puts the end faces at the ends, as wide as the stack is across", () => {
    expect(facing("LENGTH_PLUS")).toMatchObject({
      centreXMm: 1000 + 2440,
      centreYMm: 500 + 610,
      faceWidthMm: 1220,
    });
    expect(facing("LENGTH_MINUS")?.centreXMm).toBe(1000);
  });

  it("gives every face its own key", () => {
    const keys = new Set(faces.map((face) => face.key));
    expect(keys.size).toBe(faces.length);
  });

  it("carries the placement, so the scene can look the product up", () => {
    for (const face of faces) expect(face.placement.itemId).toBe("b1");
  });
});

describe("the marking on top", () => {
  it("writes the description on the top of a stack as well as its sides", () => {
    const faces = labelFaces([at(0, 0, 0)]);
    expect(faces.map((face) => face.facing)).toContain("TOP");
    expect(faces.length).toBe(5);
  });

  it("puts it on the top of the stack, not of the lowest bundle", () => {
    const faces = labelFaces([at(0, 0, 0), at(0, 0, 1000)]);
    const top = faces.find((face) => face.facing === "TOP");
    expect(top?.centreZMm).toBe(2000);
  });

  it("measures it by the stack's footprint", () => {
    const top = labelFaces([at(0, 0, 0)]).find((face) => face.facing === "TOP");
    expect(top?.faceWidthMm).toBe(2440);
    expect(top?.faceHeightMm).toBe(1220);
    expect(top?.tagWidthMm).toBeLessThanOrEqual(2440);
    expect(top?.tagHeightMm).toBeLessThanOrEqual(1220);
  });

  it("leaves it off a stack something is standing on", () => {
    // A different product resting on this one: its top is not a top any more.
    const faces = labelFaces([
      at(0, 0, 0),
      at(0, 0, 1000, { itemId: "b2", label: "Curved" }),
    ]);
    const buried = faces.filter(
      (face) => face.placement.itemId === "b1" && face.facing === "TOP",
    );
    expect(buried).toEqual([]);
    // The one on top still gets its own.
    expect(
      faces.filter(
        (face) => face.placement.itemId === "b2" && face.facing === "TOP",
      ).length,
    ).toBe(1);
  });

  it("leaves it off a footprint too small to read", () => {
    const faces = labelFaces([at(0, 0, 0, { widthMm: 90 })]);
    expect(faces.map((face) => face.facing)).not.toContain("TOP");
  });
});
