import { describe, expect, it } from "vitest";
import {
  IMPORT_TYPE_RULES,
  importTypeRule,
  naturalKeyFor,
  SUPPORTED_IMPORT_TYPES,
  validateRow,
} from "./import-rules.js";

/**
 * The rule these tests exist for: a type that is offered must be a type that
 * writes something. Three of the four kinds of import on the screen used to
 * validate a file, preview it, report COMMITTED, and create no records at all.
 */

describe("import type rules", () => {
  it("offers no type that commits without writing anything", () => {
    for (const [type, rule] of Object.entries(IMPORT_TYPE_RULES)) {
      expect(rule.writesRecords, `${type} is offered but writes nothing`).toBe(
        true,
      );
    }
  });

  it("gives every supported type a natural key and something to require", () => {
    for (const type of SUPPORTED_IMPORT_TYPES) {
      const rule = importTypeRule(type);
      expect(rule).toBeDefined();
      expect(rule?.naturalKeys.length, type).toBeGreaterThan(0);
      expect(rule?.requiredFields.length, type).toBeGreaterThan(0);
    }
  });

  it("finds a customer by its customer number", () => {
    expect(
      naturalKeyFor("CUSTOMERS", {
        customerNumber: " C-1042 ",
        canonicalName: "Cairo Construction",
      }),
    ).toBe("C-1042");
  });

  it("falls back to the source key when the customer number is blank", () => {
    expect(
      naturalKeyFor("CUSTOMERS", {
        customerNumber: "  ",
        sourceCustomerKey: "ERP-88",
      }),
    ).toBe("ERP-88");
  });

  it("has no key for a row that carries none, rather than inventing one", () => {
    expect(
      naturalKeyFor("CUSTOMERS", { canonicalName: "No number" }),
    ).toBeNull();
  });

  it("names every missing column, not just the first", () => {
    const issues = validateRow("CUSTOMERS", { customerNumber: "C-1" });

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message)).toEqual([
      "Required field canonicalName is missing.",
      "Required field countryCode is missing.",
    ]);
  });

  it("treats whitespace as missing, because it is", () => {
    const issues = validateRow("ITEM_MASTER", {
      sku: "SKU-1",
      description: "   ",
      familyCode: "ACROW_BOARD",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("description");
  });

  it("requires a family on an item, so nothing is filed under a guess", () => {
    expect(importTypeRule("ITEM_MASTER")?.requiredFields).toContain(
      "familyCode",
    );
  });

  it("checks country scope on the types that carry a country", () => {
    expect(importTypeRule("SALES_ORDERS")?.countryScoped).toBe(true);
    expect(importTypeRule("CUSTOMERS")?.countryScoped).toBe(true);
    // An item master is a catalogue, not a territory.
    expect(importTypeRule("ITEM_MASTER")?.countryScoped).toBe(false);
  });

  it("knows nothing about a type it does not support", () => {
    expect(importTypeRule("FINANCE")).toBeUndefined();
    expect(validateRow("FINANCE", {})).toEqual([]);
    expect(naturalKeyFor("FINANCE", { id: "x" })).toBe("x");
  });
});
