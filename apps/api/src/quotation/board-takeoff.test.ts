import { describe, expect, it } from "vitest";
import {
  arcLengthMm,
  computeBoardTakeoff,
  defaultOrientationFor,
} from "./board-takeoff.js";

describe("board take-off", () => {
  it("does not take off a standard sheet, because the sheet is already the board", () => {
    const takeoff = computeBoardTakeoff({
      materialClass: "STANDARD",
      quantity: 10,
      thicknessMm: 18,
      widthMm: 1220,
      lengthMm: 2440,
    });
    expect(takeoff.derived).toBe(false);
    expect(takeoff.totalBoards).toBe(0);
  });

  it("tiles a four-sided rectangular column from its height and face widths", () => {
    // 600 mm faces, 3000 mm tall. Board stands up: 1220 across, 2440 up.
    // Across: ceil(600/1220) = 1.  Up: ceil(3000/2440) = 2.  Two per face.
    const takeoff = computeBoardTakeoff({
      materialClass: "REGULAR",
      quantity: 1,
      heightMm: 3000,
      sideWidthsMm: [600, 600, 600, 600],
    });
    expect(takeoff.derived).toBe(true);
    expect(takeoff.faces).toHaveLength(4);
    expect(takeoff.faces[0]?.boardsAcross).toBe(1);
    expect(takeoff.faces[0]?.boardsUp).toBe(2);
    expect(takeoff.boardsPerUnit).toBe(8);
    expect(takeoff.totalBoards).toBe(8);
  });

  it("multiplies the take-off by the number of columns ordered", () => {
    const takeoff = computeBoardTakeoff({
      materialClass: "REGULAR",
      quantity: 12,
      heightMm: 3000,
      sideWidthsMm: [600, 600, 600, 600],
    });
    expect(takeoff.boardsPerUnit).toBe(8);
    expect(takeoff.totalBoards).toBe(96);
  });

  it("handles six- and eight-sided columns with unequal faces", () => {
    const six = computeBoardTakeoff({
      materialClass: "REGULAR",
      quantity: 1,
      heightMm: 2400,
      sideWidthsMm: [1400, 700, 700, 1400, 700, 700],
    });
    // 1400 needs 2 across, 700 needs 1. Height 2400 <= 2440, so 1 up.
    expect(six.boardsPerUnit).toBe(2 + 1 + 1 + 2 + 1 + 1);
    expect(six.notes).toHaveLength(0);

    const odd = computeBoardTakeoff({
      materialClass: "REGULAR",
      quantity: 1,
      heightMm: 2400,
      sideWidthsMm: [600, 600, 600],
    });
    expect(odd.notes.join(" ")).toMatch(/4, 6 or 8 faces/);
  });

  it("wraps a core on all four inner faces", () => {
    // 2000 x 1000 shaft, 3000 tall.
    // Long: ceil(2000/1220)=2 across, ceil(3000/2440)=2 up -> 4 each, x2 faces.
    // Short: ceil(1000/1220)=1 across, 2 up -> 2 each, x2 faces.
    const takeoff = computeBoardTakeoff({
      materialClass: "CORE",
      quantity: 1,
      lengthMm: 2000,
      widthMm: 1000,
      heightMm: 3000,
    });
    expect(takeoff.faces.map((f) => f.boards)).toEqual([8, 4]);
    expect(takeoff.boardsPerUnit).toBe(12);
  });

  it("treats a wall as one face and rounds up on both axes", () => {
    const takeoff = computeBoardTakeoff({
      materialClass: "WALL",
      quantity: 1,
      lengthMm: 5000,
      heightMm: 2700,
    });
    // ceil(5000/1220) = 5 across, ceil(2700/2440) = 2 up.
    expect(takeoff.boardsPerUnit).toBe(10);
    expect(takeoff.faces[0]?.boardsAcross).toBe(5);
    expect(takeoff.faces[0]?.boardsUp).toBe(2);
  });

  it("lays curved work on edge, with the 2440 running along the arc", () => {
    expect(defaultOrientationFor("CURVED")).toBe("LONG_SIDE_HORIZONTAL");
    expect(defaultOrientationFor("CIRCULAR")).toBe("LONG_SIDE_HORIZONTAL");
    expect(defaultOrientationFor("WALL")).toBe("LONG_SIDE_VERTICAL");

    const takeoff = computeBoardTakeoff({
      materialClass: "CURVED",
      quantity: 1,
      arcLengthMm: 5000,
      heightMm: 1200,
    });
    // On edge: 2440 along the arc -> two full boards plus a 120 mm offcut
    //          piece, 1220 up the height -> one 1200 mm piece.
    expect(takeoff.orientation).toBe("LONG_SIDE_HORIZONTAL");
    expect(takeoff.faces[0]?.boardsAcross).toBe(3);
    expect(takeoff.faces[0]?.boardsUp).toBe(1);
    expect(takeoff.boardsPerUnit).toBe(3);
  });

  it("strikes an arc from diameter and angle, not from the whole circle", () => {
    // The Engineering Studio's own curve_arc_length.
    expect(arcLengthMm(1000, 360)).toBeCloseTo(Math.PI * 1000, 6);
    expect(arcLengthMm(1000, 90)).toBeCloseTo((Math.PI * 1000) / 4, 6);
    expect(arcLengthMm(1000)).toBeCloseTo(Math.PI * 1000, 6);
    expect(arcLengthMm(0, 90)).toBe(0);

    const quarter = computeBoardTakeoff({
      materialClass: "CURVED",
      quantity: 1,
      diameterMm: 1000,
      arcAngleDeg: 90,
      heightMm: 1200,
    });
    // A 90-degree bend is a quarter of the ring: 785.4 mm, not 3141.6 mm.
    expect(quarter.faces[0]?.widthMm).toBeCloseTo(785.4, 1);
    expect(quarter.boardsPerUnit).toBe(1);
    expect(quarter.notes.join(" ")).toMatch(/90° \/ 360/);

    const full = computeBoardTakeoff({
      materialClass: "CIRCULAR",
      quantity: 2,
      diameterMm: 1000,
      heightMm: 3000,
    });
    expect(full.faces[0]?.widthMm).toBeCloseTo(3141.59, 1);
    expect(full.boardsPerUnit).toBe(6);
    expect(full.totalBoards).toBe(12);
  });

  it("cuts the remainder to size instead of wasting a board", () => {
    // 1300 x 2500 off a 1220 x 2440 board: one full board, plus an 80 mm
    // strip, plus a 60 mm course, plus the corner. Four pieces, no waste.
    const takeoff = computeBoardTakeoff({
      materialClass: "WALL",
      quantity: 1,
      lengthMm: 1300,
      heightMm: 2500,
    });
    expect(takeoff.boardsPerUnit).toBe(4);
    const sizes = takeoff.cutList.map((piece) => [
      Math.round(piece.widthMm),
      Math.round(piece.heightMm),
      piece.count,
    ]);
    // Sorted largest area first, which is the order they come off the saw.
    expect(sizes).toEqual([
      [1220, 2440, 1],
      [80, 2440, 1],
      [1220, 60, 1],
      [80, 60, 1],
    ]);
    // Every millimetre of board becomes part of the wall.
    const cutArea = takeoff.cutList.reduce(
      (sum, piece) => sum + piece.widthMm * piece.heightMm * piece.count,
      0,
    );
    expect(cutArea).toBeCloseTo(takeoff.coveredAreaMm2, 6);
    expect(cutArea).toBeCloseTo(1300 * 2500, 6);
  });

  it("marks which pieces are whole boards and which are cut down", () => {
    const takeoff = computeBoardTakeoff({
      materialClass: "WALL",
      quantity: 1,
      lengthMm: 2440,
      heightMm: 4880,
    });
    // Exactly two boards across and two up, all four whole.
    expect(takeoff.boardsPerUnit).toBe(4);
    expect(takeoff.cutList).toHaveLength(1);
    expect(takeoff.cutList[0]?.fullBoard).toBe(true);
    expect(takeoff.cutList[0]?.count).toBe(4);
  });

  it("returns nothing rather than a guess when the geometry is incomplete", () => {
    for (const input of [
      { materialClass: "REGULAR" as const, quantity: 1, heightMm: 3000 },
      {
        materialClass: "REGULAR" as const,
        quantity: 1,
        sideWidthsMm: [600, 600, 600, 600],
      },
      { materialClass: "WALL" as const, quantity: 1, lengthMm: 5000 },
      { materialClass: "CIRCULAR" as const, quantity: 1, heightMm: 3000 },
      {
        materialClass: "CORE" as const,
        quantity: 1,
        lengthMm: 2000,
        heightMm: 3000,
      },
    ]) {
      const takeoff = computeBoardTakeoff(input);
      expect(takeoff.derived).toBe(false);
      expect(takeoff.totalBoards).toBe(0);
    }
  });

  it("honours a non-standard reference board", () => {
    const takeoff = computeBoardTakeoff({
      materialClass: "WALL",
      quantity: 1,
      lengthMm: 3000,
      heightMm: 3000,
      referenceBoard: { widthMm: 1000, lengthMm: 3000 },
    });
    expect(takeoff.faces[0]?.boardsAcross).toBe(3);
    expect(takeoff.faces[0]?.boardsUp).toBe(1);
    expect(takeoff.boardsPerUnit).toBe(3);
  });
});
