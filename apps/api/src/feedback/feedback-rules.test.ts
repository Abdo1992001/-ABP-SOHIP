import { describe, expect, it } from "vitest";
import {
  canFollowUp,
  complaintSeverity,
  dialable,
  needsComplaint,
  normaliseReference,
  satisfaction,
} from "./feedback-rules.js";

describe("normaliseReference", () => {
  it("strips what people type around a reference", () => {
    expect(normaliseReference("  #so-000001. ")).toBe("SO-000001");
    expect(normaliseReference("qt-2026-0010")).toBe("QT-2026-0010");
    expect(normaliseReference("55-sep-abp-2026")).toBe("55-SEP-ABP-2026");
  });
});

describe("needsComplaint", () => {
  it("raises a complaint for critical feedback and very unhappy problems", () => {
    expect(
      needsComplaint({ kindCode: "SATISFACTION", critical: true, rating: 5 }),
    ).toBe(true);
    expect(
      needsComplaint({ kindCode: "PROBLEM", critical: false, rating: 2 }),
    ).toBe(true);
    expect(
      needsComplaint({ kindCode: "PROBLEM", critical: false, rating: 3 }),
    ).toBe(false);
    expect(
      needsComplaint({ kindCode: "SUGGESTION", critical: false, rating: 1 }),
    ).toBe(false);
    expect(
      needsComplaint({ kindCode: "PROBLEM", critical: false, rating: null }),
    ).toBe(false);
  });
  it("grades the complaint", () => {
    expect(complaintSeverity({ critical: true, rating: 4 })).toBe("CRITICAL");
    expect(complaintSeverity({ critical: false, rating: 1 })).toBe("HIGH");
    expect(complaintSeverity({ critical: false, rating: 2 })).toBe("MEDIUM");
  });
});

describe("dialable", () => {
  it("writes Egyptian numbers in international form", () => {
    expect(dialable("0100 123 4567")).toBe("+201001234567");
    expect(dialable("00971501234567")).toBe("+971501234567");
    expect(dialable("+20 2 2345 6789")).toBe("+20223456789");
    expect(dialable("")).toBeNull();
  });
});

describe("satisfaction", () => {
  it("averages the ratings and counts 4s and 5s", () => {
    expect(satisfaction([5, 4, 2, null, 5])).toEqual({
      responses: 4,
      average: 4,
      csatPct: 75,
      distribution: [0, 1, 0, 1, 2],
    });
    expect(satisfaction([null]).average).toBeNull();
  });
});

describe("canFollowUp", () => {
  it("only moves forward", () => {
    expect(canFollowUp("NEW", "CONTACTED")).toBe(true);
    expect(canFollowUp("CONTACTED", "NEW")).toBe(false);
    expect(canFollowUp("CLOSED", "CONTACTED")).toBe(false);
  });
});
