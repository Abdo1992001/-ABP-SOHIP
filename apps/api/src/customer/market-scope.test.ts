import { describe, expect, it } from "vitest";
import {
  classifyMarketScope,
  classifyMarketScopeAsOf,
  LOCAL_MARKET_COUNTRY_CODES,
} from "./market-scope.js";

describe("CR-001 market classification", () => {
  it.each(["EG", "LY", "SA", "AE"])("classifies %s as LOCAL", (code) => {
    expect(classifyMarketScope(code)).toBe("LOCAL");
  });

  it("keeps historical classification as-was across the effective date", () => {
    expect(
      classifyMarketScopeAsOf("LY", new Date("2026-08-24T20:59:59Z")),
    ).toEqual({ classification: "GLOBAL", ruleVersion: "R1-PRE-CR001" });
    expect(
      classifyMarketScopeAsOf("LY", new Date("2026-08-24T21:00:00Z")),
    ).toEqual({
      classification: "LOCAL",
      ruleVersion: "CR-001-2026-08-25",
    });
  });

  it("classifies every other known country as GLOBAL", () => {
    expect(classifyMarketScope("AU")).toBe("GLOBAL");
    expect(classifyMarketScope("de")).toBe("GLOBAL");
  });

  it("keeps missing country truth explicitly unclassified", () => {
    expect(classifyMarketScope(null)).toBe("UNCLASSIFIED");
    expect(classifyMarketScope(undefined)).toBe("UNCLASSIFIED");
    expect(classifyMarketScope("  ")).toBe("UNCLASSIFIED");
  });

  it("exposes exactly the CR-001 local business set", () => {
    expect([...LOCAL_MARKET_COUNTRY_CODES].sort()).toEqual(
      ["EG", "LY", "SA", "AE"].sort(),
    );
  });
});
