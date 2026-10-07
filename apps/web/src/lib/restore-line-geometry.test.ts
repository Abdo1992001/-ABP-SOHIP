import { describe, expect, it } from "vitest";
import { restoreLineGeometry } from "./restore-line-geometry.ts";

/**
 * The snapshots below are the two the server wrote for scratch quotation
 * 42-Sep-ABP-2026, read out of the database -- not invented. They are the
 * shape every column and circular line saved before this change has.
 */
const savedColumn = {
  column: {
    shape: "RECTANGULAR",
    totalFaces: 8,
    totalPanels: 16,
    faceWidthsMm: [400, 600, 420, 620],
    columnQuantity: "2",
    facesPerColumn: 4,
    courseLengthsMm: [2000, 2000],
    curvedFaceCount: 0,
    panelsPerColumn: 8,
    verticalCourses: 2,
  },
};

const savedCircular = {
  circular: {
    pieces: [
      { widthMm: "1571", heightMm: "1200", totalCount: 12, countPerColumn: 4 },
    ],
    radiusMm: "500",
    diameterMm: "1000",
    arcModuleMm: "2440",
    totalPieces: 12,
    arcPieceCount: 1,
    columnQuantity: "3",
    piecesPerColumn: 4,
    verticalCourseMm: "1200",
    verticalCourseCount: 2,
  },
};

describe("restoreLineGeometry — a line saved before the inputs were kept", () => {
  it("rebuilds a rectangular column from its faces and its lifts", () => {
    // Typed as A 400, B 600, height 4000, two columns.
    expect(restoreLineGeometry(savedColumn)).toEqual({
      qty: "2",
      sideAMm: "400",
      sideBMm: "600",
      columnHeightMm: "4000",
    });
  });

  it("puts the count back as columns, not as the panels they produced", () => {
    // The saved qty is 16 panels; the schedule multiplies columns, so 16
    // here would be sixteen columns and 128 panels.
    expect(restoreLineGeometry(savedColumn).qty).toBe("2");
  });

  it("rebuilds a circular column's height and mould from its pieces", () => {
    // Typed as diameter 1000, height 2400, three columns.
    expect(restoreLineGeometry(savedCircular)).toEqual({
      qty: "3",
      columnHeightMm: "2400",
      mouldSegments: "2",
      diameterMm: "1000",
      radiusMm: "500",
      arcModuleMm: "2440",
      verticalCourseMm: "1200",
    });
  });

  it("recovers a height that is not a whole number of courses", () => {
    // 3000 mm at 1200 mm courses: two full courses and a 600 mm remainder.
    const partial = {
      circular: {
        ...savedCircular.circular,
        pieces: [
          {
            widthMm: "1571",
            heightMm: "1200",
            totalCount: 12,
            countPerColumn: 4,
          },
          {
            widthMm: "1571",
            heightMm: "600",
            totalCount: 6,
            countPerColumn: 2,
          },
        ],
        piecesPerColumn: 6,
        verticalCourseCount: 3,
      },
    };
    expect(restoreLineGeometry(partial).columnHeightMm).toBe("3000");
  });
});

describe("restoreLineGeometry — a line saved with its inputs", () => {
  it("prefers the typed inputs over anything derived", () => {
    const kept = {
      column: {
        ...savedColumn.column,
        sideAMm: "450",
        sideBMm: "650",
        columnHeightMm: "3900",
        curvedFaceNumbers: [2],
      },
    };
    expect(restoreLineGeometry(kept)).toMatchObject({
      sideAMm: "450",
      sideBMm: "650",
      columnHeightMm: "3900",
      curvedFaceNumbers: [2],
    });
  });

  it("does not guess sides for an irregular column, which names its faces", () => {
    const irregular = { column: { ...savedColumn.column, shape: "IRREGULAR" } };
    const restored = restoreLineGeometry(irregular);
    expect(restored.sideAMm).toBeUndefined();
    expect(restored.sideBMm).toBeUndefined();
  });
});

describe("restoreLineGeometry — nothing to restore", () => {
  it("leaves a flat board alone", () => {
    expect(restoreLineGeometry({ inputs: { widthMm: "1220" } })).toEqual({});
  });

  it("copes with no snapshot at all", () => {
    expect(restoreLineGeometry(null)).toEqual({});
    expect(restoreLineGeometry("x")).toEqual({});
  });
});
