import { describe, expect, it } from "vitest";
import { officialQuotationHtml } from "./workflow-handlers.js";

/**
 * The client document is the one artefact a customer ever reads. Two rules it
 * must never break: it states the delivered weight, and it never states the
 * internal rate per kilogram (spec SS18/SS20).
 */
function quote(overrides: Record<string, unknown> = {}) {
  return {
    quotationRef: "Q-2026-0001",
    documentTypeCode: "QUOTATION",
    currencyCode: "EGP",
    createdAt: new Date("2026-09-16T00:00:00.000Z"),
    expiresOn: null,
    incotermCode: null,
    paymentTermsCode: null,
    customPaymentTerms: null,
    subtotalAmount: 351792,
    adjustmentAmount: 0,
    taxAmount: 49250.88,
    totalAmount: 401042.88,
    account: { name: "Orascom", country: { name: "Egypt" } },
    project: null,
    owner: { displayName: "Sales", profile: { phone: "" } },
    lines: [
      {
        description:
          "Acrow Board 18 mm \u00d7 1885 mm \u00d7 1200 mm (M Board Curved) (D=1200 mm)",
        qty: 100,
        unitCode: "PCS",
        unitPrice: 3517.92,
        discountAmount: 0,
        lineTotal: 351792,
        sectionLabel: null,
        productImageId: null,
        priceSnapshot: {
          source: "ENGINEERING_CALC",
          reference: "CRV-001",
          appliedPricePerKg: "120",
          weightPerPieceKg: "29.316",
          totalWeightKg: "2931.600",
        },
      },
    ],
    ...overrides,
  };
}

describe("officialQuotationHtml", () => {
  it("states the delivered weight per piece and for the line", () => {
    const html = officialQuotationHtml(quote());
    expect(html).toContain("Weight / Pc (kg)");
    expect(html).toContain("Total Weight (kg)");
    expect(html).toContain("29.316");
    expect(html).toContain("2,931.600");
  });

  it("never prints the internal rate per kilogram", () => {
    // The embedded logo is a base64 data URI and will contain any two-letter
    // sequence you care to look for, so it is dropped before searching.
    const html = officialQuotationHtml(quote()).replaceAll(
      /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g,
      "",
    );
    expect(html).not.toContain("/kg");
    expect(html).not.toContain("per kg");
    expect(html).not.toContain("appliedPricePerKg");
    // 120 EGP/kg is the rate this line was priced at; it must not appear as a
    // money figure anywhere in the customer's copy.
    expect(html).not.toContain("EGP 120.00");
  });

  it("carries the line reference when there is one", () => {
    const html = officialQuotationHtml(quote());
    expect(html).toContain("Ref.");
    expect(html).toContain("CRV-001");
  });

  it("leaves the weight columns out when nothing has been weighed", () => {
    const bare = quote();
    const html = officialQuotationHtml({
      ...bare,
      lines: bare.lines.map((line) => ({ ...line, priceSnapshot: null })),
    });
    expect(html).not.toContain("Weight / Pc (kg)");
    expect(html).not.toContain("Ref.");
  });

  it("shows the discount, what it is as a percentage, and the net it leaves", () => {
    const html = officialQuotationHtml(
      quote({
        adjustmentAmount: -35179.2,
        taxAmount: 44325.79,
        totalAmount: 360938.59,
      }),
    );
    expect(html).toContain("Discount (10%)");
    expect(html).toContain("Net Amount");
    expect(html).toContain("Subtotal (excl. VAT)");
  });

  it("states the VAT percentage it charged", () => {
    const html = officialQuotationHtml(quote());
    expect(html).toContain("VAT (14%)");
  });

  it("totals the weight of the whole quotation", () => {
    const html = officialQuotationHtml(quote());
    expect(html).toContain("<td>Total Weight</td>");
  });

  it("shows the item code beside the description when the line has one", () => {
    const base = quote();
    const html = officialQuotationHtml({
      ...base,
      lines: base.lines.map((line) => ({
        ...line,
        product: { skuCode: "2001030008403", productImages: [] },
      })),
    });
    expect(html).toContain("Item Code");
    expect(html).toContain("2001030008403");
  });

  it("leaves the item code column off when no line is coded", () => {
    expect(officialQuotationHtml(quote())).not.toContain("Item Code");
  });
});
