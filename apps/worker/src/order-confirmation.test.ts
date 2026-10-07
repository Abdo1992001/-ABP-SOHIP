import { describe, expect, it } from "vitest";
import {
  orderConfirmationHtml,
  type ConfirmationData,
} from "./order-confirmation.js";

const order: ConfirmationData = {
  orderRef: "SO-000001",
  amendmentNo: 0,
  confirmedAt: new Date("2026-10-01T09:00:00Z"),
  customerName: "Arab <Contractors>",
  customerPoNumber: "PO-QA-0001",
  quotationRef: "QT-2026-0011",
  requestedDeliveryDate: new Date("2026-10-20"),
  deliveryTerms: null,
  deliveryPoint: null,
  currencyCode: "EGP",
  subtotal: 1_000_000,
  adjustment: 0,
  vatRate: 0.14,
  tax: 140_000,
  total: 1_140_000,
  paymentTermsText: "50% advance, 50% before delivery.",
  notes: null,
  salesName: "Mohamed Ramadan",
  salesEmail: "m.ramadan@abp.com",
  lines: [
    {
      lineNo: 1,
      itemCode: "ABP-18-1220",
      description: "Film-faced board 18 mm",
      quantity: 2000,
      unitCode: "PCS",
      unitPrice: 500,
      lineTotal: 1_000_000,
    },
  ],
  installments: [
    { label: "Advance", dueDate: new Date("2026-10-02"), amount: 570_000 },
    { label: "Before delivery", dueDate: null, amount: 570_000 },
  ],
};

describe("order confirmation", () => {
  it("states what was ordered, at what price and on what terms", () => {
    const html = orderConfirmationHtml(order, "en");
    expect(html).toContain("Order confirmation SO-000001");
    expect(html).toContain("PO-QA-0001");
    expect(html).toContain("ABP-18-1220");
    expect(html).toContain("1,140,000.00 EGP");
    expect(html).toContain("VAT 14%");
    expect(html).toContain("Before delivery");
    expect(html).toContain("On the agreed event");
    // Typed names are escaped, never markup.
    expect(html).toContain("Arab &lt;Contractors&gt;");
  });

  it("marks an amended order and reads right to left in Arabic", () => {
    const html = orderConfirmationHtml({ ...order, amendmentNo: 2 }, "ar");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("تأكيد أمر التوريد");
    expect(html).toContain("تعديل");
  });
});
