import { describe, expect, it } from "vitest";
import { clampDate } from "./target-window.js";

const min = new Date("2026-01-01T00:00:00Z");
const max = new Date("2027-01-01T00:00:00Z");

describe("clampDate", () => {
  it("uses the default when nothing is asked for", () => {
    expect(clampDate(undefined, min, min, max)).toEqual(min);
    expect(clampDate("", max, min, max)).toEqual(max);
  });
  it("keeps a date inside the year", () => {
    expect(clampDate("2026-09-01", min, min, max)).toEqual(
      new Date("2026-09-01T00:00:00Z"),
    );
  });
  it("never reaches outside the year", () => {
    expect(clampDate("2025-12-01", min, min, max)).toEqual(min);
    expect(clampDate("2027-03-01", min, min, max)).toEqual(max);
  });
  it("refuses what is not a date", () => {
    expect(clampDate("soon", min, min, max)).toBeNull();
  });
});
