import { describe, expect, it } from "vitest";
import {
  defaultPreviewPerson,
  parsePeople,
  personStanding,
  scopeWindow,
  type PersonTarget,
} from "./person-targets.ts";

const person = (over: Partial<PersonTarget> = {}): PersonTarget => ({
  userId: "u1",
  displayName: "Dina Youssef",
  targetEgp: 12_000_000,
  wonEgp: 0,
  pipelineEgp: 0,
  openOpportunities: 0,
  ...over,
});

describe("parsePeople", () => {
  it("reads the envelope and keeps a missing target as null", () => {
    expect(
      parsePeople({
        data: [
          {
            userId: "u1",
            displayName: "Dina",
            targetEgp: null,
            wonEgp: "150.50",
            pipelineEgp: "10",
            openOpportunities: 2,
          },
        ],
      }),
    ).toEqual([
      {
        userId: "u1",
        displayName: "Dina",
        targetEgp: null,
        wonEgp: 150.5,
        pipelineEgp: 10,
        openOpportunities: 2,
      },
    ]);
  });
  it("skips malformed rows and survives a malformed payload", () => {
    expect(parsePeople({ data: [{ userId: 1 }, null] })).toEqual([]);
    expect(parsePeople(null)).toEqual([]);
  });
});

describe("scopeWindow", () => {
  const now = new Date("2026-09-28T10:00:00Z");
  it("covers this month", () => {
    expect(scopeWindow("MONTH", now)).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
      months: 1,
    });
  });
  it("covers this quarter", () => {
    expect(scopeWindow("QUARTER", now)).toEqual({
      from: "2026-07-01",
      to: "2026-10-01",
      months: 3,
    });
  });
  it("covers the year, across December", () => {
    expect(scopeWindow("YEAR", now)).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
      months: 12,
    });
  });
  it("counts every month a custom range touches", () => {
    expect(scopeWindow("CUSTOM", now, "2026-02-15", "2026-04-03")).toEqual({
      from: "2026-02-01",
      to: "2026-05-01",
      months: 3,
    });
  });
  it("falls back to the year for a backwards range", () => {
    expect(scopeWindow("CUSTOM", now, "2026-05-01", "2026-02-01").months).toBe(
      12,
    );
  });
});

describe("personStanding", () => {
  it("judges a month against a twelfth of the year", () => {
    const s = personStanding(person({ wonEgp: 500_000 }), 1);
    expect(s.target).toBe(1_000_000);
    expect(s.achievedPct).toBe(50);
    expect(s.remaining).toBe(500_000);
  });
  it("does not go below nothing left to do", () => {
    expect(personStanding(person({ wonEgp: 20_000_000 }), 12).remaining).toBe(
      0,
    );
  });
  it("has no target and no remaining when none is set", () => {
    const s = personStanding(person({ targetEgp: null, wonEgp: 5 }), 12);
    expect(s.target).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.achievedPct).toBe(0);
  });
});

describe("defaultPreviewPerson", () => {
  it("opens on the first person with figures", () => {
    const idle = person({ userId: "a" });
    const busy = person({ userId: "b", openOpportunities: 3 });
    expect(defaultPreviewPerson([idle, busy])?.userId).toBe("b");
  });
  it("falls back to the first, or nobody", () => {
    expect(defaultPreviewPerson([person({ userId: "a" })])?.userId).toBe("a");
    expect(defaultPreviewPerson([])).toBeNull();
  });
});
