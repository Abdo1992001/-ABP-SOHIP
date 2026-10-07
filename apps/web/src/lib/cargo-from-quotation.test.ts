import { describe, expect, it } from "vitest";
import type { BoardLine } from "./cargo-bundling.ts";
import {
  boardsFromLine,
  cutSizesOf,
  type QuotationLineLike,
} from "./cargo-from-quotation.ts";

/** Whatever the caller makes of a plain line; the shape, not the reading. */
const single = (line: QuotationLineLike, index: number): BoardLine => ({
  id: `L${String(index)}`,
  description: typeof line.description === "string" ? line.description : "",
  thicknessMm: 18,
  widthMm: 1220,
  lengthMm: 2440,
  densityKgM3: 600,
  unitWeightKg: 32.149,
  quantity: typeof line.qty === "number" ? line.qty : 1,
});

/** A rectangular column: four faces, two of them the closing pair. */
const columnLine: QuotationLineLike = {
  quotationLineId: "line-1",
  description: "Acrow Board 18 mm × 620 mm × 2000 mm (M Board) (+3 sizes)",
  qty: 4,
  priceSnapshot: {
    materialClass: "REGULAR",
    calculatedWeightKg: "13.392",
    column: {
      panels: [
        { widthMm: 620, lengthMm: 2000, totalCount: 8 },
        { widthMm: 400, lengthMm: 2000, totalCount: 8 },
        { widthMm: 638, lengthMm: 2000, totalCount: 4 },
        { widthMm: 418, lengthMm: 2000, totalCount: 4 },
      ],
    },
  },
};

const circularLine: QuotationLineLike = {
  quotationLineId: "line-2",
  description:
    "Acrow Board 18 mm × 1571 mm × 1200 mm (M Board Curved) (+1 size)",
  qty: 2,
  priceSnapshot: {
    materialClass: "CIRCULAR",
    circular: {
      diameterMm: "1000",
      pieces: [
        { widthMm: "1571", heightMm: "1200", totalCount: 8 },
        { widthMm: "1571", heightMm: "600", totalCount: 4 },
      ],
    },
  },
};

const plainLine: QuotationLineLike = {
  quotationLineId: "line-3",
  description: "Acrow Board 18 mm × 1220 mm × 2440 mm (M Board)",
  qty: 300,
  priceSnapshot: { materialClass: "STANDARD", calculatedWeightKg: "32.149" },
};

describe("cutSizesOf", () => {
  it("reads every panel a column delivers", () => {
    expect(cutSizesOf(columnLine)).toEqual([
      { widthMm: 620, lengthMm: 2000, count: 8 },
      { widthMm: 400, lengthMm: 2000, count: 8 },
      { widthMm: 638, lengthMm: 2000, count: 4 },
      { widthMm: 418, lengthMm: 2000, count: 4 },
    ]);
  });

  it("reads a circular piece by its arc width and its course height", () => {
    expect(cutSizesOf(circularLine)).toEqual([
      { widthMm: 1571, lengthMm: 1200, count: 8 },
      { widthMm: 1571, lengthMm: 600, count: 4 },
    ]);
  });

  it("adds two panels of the same size together", () => {
    expect(
      cutSizesOf({
        priceSnapshot: {
          column: {
            panels: [
              { widthMm: 620, lengthMm: 2000, totalCount: 4 },
              { widthMm: 620, lengthMm: 2000, totalCount: 6 },
            ],
          },
        },
      }),
    ).toEqual([{ widthMm: 620, lengthMm: 2000, count: 10 }]);
  });

  it("drops a panel with no size or no count", () => {
    expect(
      cutSizesOf({
        priceSnapshot: {
          column: {
            panels: [
              { widthMm: 0, lengthMm: 2000, totalCount: 4 },
              { widthMm: 620, lengthMm: 2000, totalCount: 0 },
              { widthMm: 620, lengthMm: 2000, totalCount: 2 },
            ],
          },
        },
      }),
    ).toEqual([{ widthMm: 620, lengthMm: 2000, count: 2 }]);
  });

  it("finds nothing on a line that delivers one board", () => {
    expect(cutSizesOf(plainLine)).toEqual([]);
    expect(cutSizesOf({})).toEqual([]);
  });
});

describe("boardsFromLine", () => {
  it("splits a column into one board per cut size", () => {
    const boards = boardsFromLine(columnLine, 0, single);
    expect(boards).toHaveLength(4);
    expect(boards.map((board) => board.quantity)).toEqual([8, 8, 4, 4]);
    expect(boards.map((board) => [board.widthMm, board.lengthMm])).toEqual([
      [620, 2000],
      [400, 2000],
      [638, 2000],
      [418, 2000],
    ]);
  });

  it("names each size in full, with no '+N sizes' anywhere", () => {
    for (const board of boardsFromLine(columnLine, 0, single)) {
      expect(board.description).not.toMatch(/\+\d+ size/);
      // Every board says its own width and its own length.
      expect(board.description).toContain(`${String(board.widthMm)} mm`);
      expect(board.description).toContain(`${String(board.lengthMm)} mm`);
    }
  });

  it("keeps the diameter on a circular piece and still names its own size", () => {
    const boards = boardsFromLine(circularLine, 0, single);
    expect(boards).toHaveLength(2);
    expect(boards[0]?.description).toContain("(D=1000 mm)");
    expect(boards[1]?.description).toContain("600 mm");
    expect(boards[1]?.description).not.toMatch(/\+\d+ size/);
  });

  it("gives each size its own id, so each gets its own colour", () => {
    const ids = boardsFromLine(columnLine, 0, single).map((board) => board.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lets the density weigh each panel rather than inheriting the line's", () => {
    // 32.149 kg is the weight of the 1220 x 2440 board the line was priced on.
    // Carrying it onto a 400 x 2000 panel would overstate the shipment by more
    // than double, and the packer checks the payload against it.
    for (const board of boardsFromLine(columnLine, 0, single))
      expect(board.unitWeightKg).toBe(0);
  });

  it("leaves a line that delivers one board exactly as it was", () => {
    const boards = boardsFromLine(plainLine, 2, single);
    expect(boards).toHaveLength(1);
    expect(boards[0]).toEqual(single(plainLine, 2));
  });

  it("leaves a one-panel schedule alone rather than renaming it", () => {
    const one: QuotationLineLike = {
      description: "Acrow Board 18 mm × 620 mm × 2000 mm (M Board)",
      qty: 4,
      priceSnapshot: {
        column: { panels: [{ widthMm: 620, lengthMm: 2000, totalCount: 8 }] },
      },
    };
    expect(boardsFromLine(one, 0, single)).toEqual([single(one, 0)]);
  });
});
