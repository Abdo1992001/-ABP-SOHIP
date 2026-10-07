import { describe, expect, it } from "vitest";
import { Prisma } from "@abp/database";
import { resolveAppliedRate } from "./pricing-hierarchy.js";

describe("resolveAppliedRate", () => {
  const companyDefault = new Prisma.Decimal("90");

  it("falls back to the company default when nothing is overridden", () => {
    const result = resolveAppliedRate(null, null, companyDefault);
    expect(result.value.toString()).toBe("90");
    expect(result.source).toBe("COMPANY_DEFAULT");
  });

  it("uses the quotation override when set and no item override exists", () => {
    const result = resolveAppliedRate(
      null,
      new Prisma.Decimal("95"),
      companyDefault,
    );
    expect(result.value.toString()).toBe("95");
    expect(result.source).toBe("QUOTATION_OVERRIDE");
  });

  it("prefers the item override over both the quotation override and company default", () => {
    const result = resolveAppliedRate(
      new Prisma.Decimal("100"),
      new Prisma.Decimal("95"),
      companyDefault,
    );
    expect(result.value.toString()).toBe("100");
    expect(result.source).toBe("ITEM_OVERRIDE");
  });
});
