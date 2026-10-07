import { describe, expect, it } from "vitest";
import {
  canCopyQuotationStatus,
  copyClosesSource,
} from "./quotation-copy-policy.js";

describe("quotation copy policy", () => {
  it.each(["SENT", "EXPIRED", "REJECTED", "CANCELLED", "SUPERSEDED"])(
    "allows a new draft to be created from %s",
    (statusCode) => {
      expect(canCopyQuotationStatus(statusCode)).toBe(true);
    },
  );

  it.each(["DRAFT", "READY", "ACCEPTED"])(
    "does not copy an active %s quotation",
    (statusCode) => {
      expect(canCopyQuotationStatus(statusCode)).toBe(false);
    },
  );

  it("only closes a sent source quotation", () => {
    expect(copyClosesSource("SENT")).toBe(true);
    expect(copyClosesSource("EXPIRED")).toBe(false);
    expect(copyClosesSource("CANCELLED")).toBe(false);
  });
});
