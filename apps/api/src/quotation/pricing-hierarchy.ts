import type { Prisma } from "@abp/database";

/**
 * Centralizes the ACROW BOARD pricing hierarchy: item override → quotation
 * override → company default. Every call site uses this instead of an ad-hoc
 * `??` chain, so a price is never applied without its source being known —
 * the source is what the UI shows next to every rate (RATE SOURCE column,
 * item edit panel, pricing settings screen).
 */

export type PriceSource =
  "COMPANY_DEFAULT" | "QUOTATION_OVERRIDE" | "ITEM_OVERRIDE";

export interface ResolvedRate {
  value: Prisma.Decimal;
  source: PriceSource;
}

export function resolveAppliedRate(
  itemOverride: Prisma.Decimal | null | undefined,
  quotationOverride: Prisma.Decimal | null | undefined,
  companyDefault: Prisma.Decimal,
): ResolvedRate {
  if (itemOverride != null)
    return { value: itemOverride, source: "ITEM_OVERRIDE" };
  if (quotationOverride != null)
    return { value: quotationOverride, source: "QUOTATION_OVERRIDE" };
  return { value: companyDefault, source: "COMPANY_DEFAULT" };
}
