import { describe, expect, it } from "vitest";
import {
  PAYMENT_PLANS,
  planForTerm,
  amountInWords,
  grossWeightKg,
  offerValidityLabel,
  paymentTermsSentence,
  splitInstalments,
} from "./quotation-document.ts";

/**
 * The expected strings and figures below are taken from documents ABP has
 * actually issued — quotation `0X-Sep-ABP-2026` and proforma `A309-2026` —
 * so a change that breaks these is a change that would issue a document
 * unlike the ones the company sends today.
 */

const plan = (code: string) => {
  const found = PAYMENT_PLANS.find((entry) => entry.code === code);
  if (found === undefined) throw new Error(`no plan ${code}`);
  return found;
};

describe("payment terms, as ABP writes them", () => {
  // Quotation 0X-Sep-ABP-2026: subtotal 1,372,747.11, VAT 192,184.60,
  // grand total 1,564,931.71.
  const grandTotal = 1_564_931.71;

  it("splits the instalments off the grand total, not the subtotal", () => {
    // The issued document reads 469,479.51 for the advance. 30% of the
    // subtotal would be 411,824.13, which is not what it says.
    const parts = splitInstalments(plan("30_35_35"), grandTotal);
    expect(parts[0]?.amount).toBeCloseTo(469_479.51, 2);
    expect(parts[1]?.amount).toBeCloseTo(547_726.1, 2);
    expect(parts[2]?.amount).toBeCloseTo(547_726.1, 2);
  });

  it("writes the sentence the issued quotation carries", () => {
    expect(paymentTermsSentence(plan("30_35_35"), grandTotal)).toBe(
      "Payment Terms: 30% in advance (469,479.51), 35% (547,726.10) after 30 days from the delivery date, and the remaining 35% (547,726.10) after 60 days from the delivery date.",
    );
  });

  it("writes the short sentence for payment in advance", () => {
    expect(paymentTermsSentence(plan("ADVANCE_100"), grandTotal)).toBe(
      "Payment Terms: 100% in advance.",
    );
  });

  it("adds the instalments back up to the grand total", () => {
    for (const entry of PAYMENT_PLANS) {
      const total = splitInstalments(entry, grandTotal).reduce(
        (sum, part) => sum + part.amount,
        0,
      );
      expect(total).toBeCloseTo(grandTotal, 2);
    }
  });
});

describe("the validity printed on the quotation", () => {
  it("prints the number of days rather than the expiry date", () => {
    expect(offerValidityLabel("2026-09-28", "2026-10-28")).toBe("30 Days");
    expect(offerValidityLabel("2026-09-28", "2026-10-05")).toBe("7 Days");
  });

  it("uses the singular form and rejects an invalid period", () => {
    expect(offerValidityLabel("2026-09-28", "2026-09-29")).toBe("1 Day");
    expect(offerValidityLabel("2026-10-01", "2026-09-28")).toBe("");
  });
});

describe("the weight a proforma declares", () => {
  it("adds the packing allowance the issued proforma used", () => {
    // A309-2026: net 4,261.80528 kg, gross 4,687.985808 kg — exactly 10%.
    expect(grossWeightKg(4_261.80528, 10)).toBeCloseTo(4_687.985808, 6);
  });

  it("leaves the weight alone when nothing is added", () => {
    expect(grossWeightKg(1_000, 0)).toBe(1_000);
  });

  it("takes a different allowance for a differently packed shipment", () => {
    expect(grossWeightKg(1_000, 7.5)).toBeCloseTo(1_075, 6);
  });
});

describe("the amount in words", () => {
  it("writes the proforma's own total the way the proforma writes it", () => {
    // A309-2026 total 5,590.331 -> 5,590.33.
    expect(amountInWords(5_590.331, "USD")).toBe(
      "US Dollars Five Thousand Five Hundred Ninety and Thirty-Three Cents Only",
    );
  });

  it("writes an Egyptian total in pounds and piastres", () => {
    expect(amountInWords(1_564_931.71, "EGP")).toBe(
      "Egyptian Pounds One Million Five Hundred Sixty-Four Thousand Nine Hundred Thirty-One and Seventy-One Piastres Only",
    );
  });

  it("says Only, with no minor unit, on a round amount", () => {
    expect(amountInWords(2_500, "EGP")).toBe(
      "Egyptian Pounds Two Thousand Five Hundred Only",
    );
  });

  it("rounds to the minor unit so the words match the figure beside them", () => {
    // 99.999 prints as 100.00, and the words have to say the same.
    expect(amountInWords(99.999, "USD")).toBe("US Dollars One Hundred Only");
  });

  it("handles zero rather than printing nothing", () => {
    expect(amountInWords(0, "USD")).toBe("US Dollars Zero Only");
  });
});

describe("the instalments behind a stored payment term", () => {
  it("knows the staged terms the archive is written on", () => {
    const plan = planForTerm("ADVANCE_30_35_35");
    expect(plan?.instalments.map((part) => part.percent)).toEqual([30, 35, 35]);
    expect(plan?.label).toBe(
      "30% advance; 35% after 30 days from delivery; 35% after 60 days",
    );
  });

  it("uses the code the database holds, not the one the screen used to invent", () => {
    // The old front-end list said ADVANCE_100 and ADVANCE_50_50; neither is a
    // row in payment_terms, and the server refused every draft that used one.
    expect(planForTerm("ADVANCE_100")).toBeNull();
    expect(planForTerm("ADVANCE_50_50")).toBeNull();
    expect(planForTerm("CASH_IN_ADVANCE")).not.toBeNull();
  });

  it("treats a credit period as one payment at the end of it", () => {
    const plan = planForTerm("NET_60");
    expect(plan?.instalments).toEqual([
      { percent: 100, daysAfterDelivery: 60 },
    ]);
  });

  it("gives a letter of credit no schedule, because it has none", () => {
    expect(planForTerm("LC_AT_SIGHT")).toBeNull();
  });

  it("adds every known plan up to the whole amount", () => {
    for (const code of [
      "CASH_IN_ADVANCE",
      "ADVANCE_30_35_35",
      "ADVANCE_50_BALANCE_ON_DELIVERY",
      "ADVANCE_25_BALANCE_ON_DELIVERY",
      "NET_30",
    ]) {
      const plan = planForTerm(code);
      const total = (plan?.instalments ?? []).reduce(
        (sum, part) => sum + part.percent,
        0,
      );
      expect(total, code).toBe(100);
    }
  });

  it("says nothing about a term it has never seen", () => {
    expect(planForTerm("SOMETHING_NEW")).toBeNull();
  });
});
