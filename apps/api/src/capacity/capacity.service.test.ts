import { Prisma } from "@abp/database";
import { describe, expect, it } from "vitest";
import { calculateCapacity } from "./capacity-calculator.js";

describe("locked capacity estimate formula", () => {
  it.each([
    ["STANDARD", "1350", 900, "1.5", "36"],
    ["ORDINARY", "700", 700, "1", "24"],
    ["CURVED", "600", 600, "1", "24"],
  ])("keeps %s at the SSOT rate", (_category, quantity, rate, days, hours) => {
    const result = calculateCapacity(new Prisma.Decimal(quantity), rate);
    expect(result.days.toString()).toBe(days);
    expect(result.hours.toString()).toBe(hours);
  });
});
