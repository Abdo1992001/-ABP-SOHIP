import { describe, expect, it } from "vitest";
import { resourceIdOf } from "./resource-id.js";

/**
 * Every idempotent command in this module records the id of what it made, and
 * the lookup was a hand-kept list of key names. A command whose id was not on
 * the list threw *after* its transaction had succeeded: adding a document
 * subject saved the row and then answered 500, with the caller told nothing
 * and the subject already in the database.
 */
describe("resourceIdOf", () => {
  it("finds an id the named list does not carry", () => {
    // The failure that prompted this: documentSubjectId was not on the list.
    expect(resourceIdOf({ somethingAddedLaterId: "abc", isActive: true })).toBe(
      "abc",
    );
  });

  it("prefers the named id when a shape carries more than one", () => {
    expect(resourceIdOf({ accountId: "wrong", taxPolicyId: "right" })).toBe(
      "right",
    );
  });

  it("never names the person who ran the command", () => {
    // createdByUserId is on most of these shapes; two commands by one person
    // would otherwise look like the same record.
    expect(() =>
      resourceIdOf({ createdByUserId: "someone", displayText: "30% advance" }),
    ).toThrow();
    expect(
      resourceIdOf({ createdByUserId: "someone", paymentTermId: "pt-1" }),
    ).toBe("pt-1");
  });

  it("ignores an id that is present but empty", () => {
    expect(() => resourceIdOf({ documentSubjectId: "" })).toThrow();
  });

  it("refuses anything that is not an object", () => {
    expect(() => resourceIdOf(null)).toThrow();
    expect(() => resourceIdOf("pt-1")).toThrow();
    expect(() => resourceIdOf(undefined)).toThrow();
  });

  it("recognises each id the module already returned", () => {
    for (const key of [
      "taxPolicyId",
      "guardrailId",
      "pricingOverrideId",
      "productId",
      "pricingBaseConfigId",
      "calculationFormulaId",
      "documentSubjectId",
    ])
      expect(resourceIdOf({ [key]: "id-1" })).toBe("id-1");
  });
});
