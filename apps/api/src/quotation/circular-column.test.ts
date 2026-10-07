import { describe, expect, it } from "vitest";
import { Prisma } from "@abp/database";
import { computeCircularColumnSchedule } from "./circular-column.js";

describe("computeCircularColumnSchedule", () => {
  it("derives diameter from radius when only radius is given", () => {
    const result = computeCircularColumnSchedule({
      radiusMm: new Prisma.Decimal("450"),
      columnHeightMm: new Prisma.Decimal("3600"),
      columnQuantity: 1,
    });
    expect(result.diameterMm.toString()).toBe("900");
  });

  it("computes the full piece schedule with default mould segments/arc module/vertical course", () => {
    // diameter 900mm -> circumference = pi*900 ~= 2827.43mm
    // 2 mould segments -> working arc ~= 1413.72mm -> ceil(1413.72/2440) = 1 arc piece
    // column height 3600mm / 1200mm vertical course -> 3 courses
    // pieces per column = 1 * 2 * 3 = 6; 5 columns -> 30 total pieces
    const result = computeCircularColumnSchedule({
      diameterMm: new Prisma.Decimal("900"),
      columnHeightMm: new Prisma.Decimal("3600"),
      columnQuantity: 5,
    });
    expect(result.arcPieceCount).toBe(1);
    expect(result.verticalCourseCount).toBe(3);
    expect(result.piecesPerColumn).toBe(6);
    expect(result.totalPieces).toBe(30);
  });

  it("respects a custom mould segment count and rounds arc pieces up", () => {
    // diameter 3000mm -> circumference = pi*3000 ~= 9424.78mm
    // 4 segments -> working arc ~= 2356.19mm -> ceil(2356.19/2440) = 1 arc piece
    const result = computeCircularColumnSchedule({
      diameterMm: new Prisma.Decimal("3000"),
      columnHeightMm: new Prisma.Decimal("2400"),
      mouldSegments: 4,
      columnQuantity: 1,
    });
    expect(result.arcPieceCount).toBe(1);
    expect(result.verticalCourseCount).toBe(2);
    expect(result.piecesPerColumn).toBe(8);
  });

  it("rounds up a working arc that exceeds a single arc module", () => {
    // diameter 5000mm -> circumference = pi*5000 ~= 15707.96mm
    // 2 segments -> working arc ~= 7853.98mm -> ceil(7853.98/2440) = 4 arc pieces
    const result = computeCircularColumnSchedule({
      diameterMm: new Prisma.Decimal("5000"),
      columnHeightMm: new Prisma.Decimal("1200"),
      columnQuantity: 2,
    });
    expect(result.arcPieceCount).toBe(4);
    expect(result.verticalCourseCount).toBe(1);
    expect(result.piecesPerColumn).toBe(8);
    expect(result.totalPieces).toBe(16);
  });

  it("delivers the acceptance example's schedule and piece size (spec SS34)", () => {
    // D1200 column, 6 m tall, 10 of them. The working arc is 1884.96mm, which
    // is ONE piece 1885mm wide -- not a full 2440mm module. Pricing the module
    // would overcharge this column by 29%.
    const result = computeCircularColumnSchedule({
      diameterMm: new Prisma.Decimal("1200"),
      columnHeightMm: new Prisma.Decimal("6000"),
      columnQuantity: 10,
    });
    expect(result.workingArcMm.toFixed(3)).toBe("1884.956");
    expect(result.arcPieceCount).toBe(1);
    expect(result.verticalCourseCount).toBe(5);
    expect(result.piecesPerColumn).toBe(10);
    expect(result.totalPieces).toBe(100);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]?.widthMm.toString()).toBe("1885");
    expect(result.pieces[0]?.heightMm.toString()).toBe("1200");
    expect(result.pieces[0]?.totalCount).toBe(100);
    expect(result.pieces[0]?.fullModule).toBe(false);
  });

  it("cuts the last arc piece to the remainder rather than a full module", () => {
    // D5000, 2 segments -> 7853.98mm working arc -> 3 full 2440mm modules and
    // one 533.98mm remainder, which is a piece, not waste.
    const result = computeCircularColumnSchedule({
      diameterMm: new Prisma.Decimal("5000"),
      columnHeightMm: new Prisma.Decimal("1200"),
      columnQuantity: 1,
    });
    expect(result.pieces.map((p) => p.widthMm.toString())).toEqual([
      "2440",
      "534",
    ]);
    expect(result.pieces[0]?.totalCount).toBe(6);
    expect(result.pieces[0]?.fullModule).toBe(true);
    expect(result.pieces[1]?.totalCount).toBe(2);
    expect(result.pieces[1]?.fullModule).toBe(false);
    expect(result.pieces.reduce((sum, p) => sum + p.totalCount, 0)).toBe(
      result.totalPieces,
    );
  });
});
