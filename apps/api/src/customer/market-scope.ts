export const LOCAL_MARKET_COUNTRY_CODES = ["AE", "EG", "LY", "SA"] as const;

const localMarketCountries = new Set<string>(LOCAL_MARKET_COUNTRY_CODES);

export type MarketScope = "LOCAL" | "GLOBAL" | "UNCLASSIFIED";

export const CR001_MARKET_RULE = {
  version: "CR-001-2026-08-25",
  effectiveFrom: new Date("2026-08-25T00:00:00+03:00"),
} as const;

/**
 * CR-001 business classification only. Authorization continues to use the
 * caller's governed Country Scope and must never consume this value as a grant.
 */
export function classifyMarketScope(
  countryCode: string | null | undefined,
): MarketScope {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized) return "UNCLASSIFIED";
  return localMarketCountries.has(normalized) ? "LOCAL" : "GLOBAL";
}

/** Reproducible as-of classifier. Before CR-001 only Egypt was Local. */
export function classifyMarketScopeAsOf(
  countryCode: string | null | undefined,
  asOf: Date,
): { classification: MarketScope; ruleVersion: string | null } {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized) return { classification: "UNCLASSIFIED", ruleVersion: null };
  if (asOf < CR001_MARKET_RULE.effectiveFrom) {
    return {
      classification: normalized === "EG" ? "LOCAL" : "GLOBAL",
      ruleVersion: "R1-PRE-CR001",
    };
  }
  return {
    classification: classifyMarketScope(normalized),
    ruleVersion: CR001_MARKET_RULE.version,
  };
}
