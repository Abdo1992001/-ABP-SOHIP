import { describe, expect, it } from "vitest";
import { localToday } from "./today.ts";

describe("localToday", () => {
  it("writes the local calendar date, zero-padded", () => {
    expect(localToday(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
  });

  it("is the local day just after midnight, not the UTC one", () => {
    // Half past midnight local time is still the previous day in UTC for any
    // zone east of Greenwich; the local date is what the person means.
    expect(localToday(new Date(2026, 9, 4, 0, 30))).toBe("2026-10-04");
  });
});
