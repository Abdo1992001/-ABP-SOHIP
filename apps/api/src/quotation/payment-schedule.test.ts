import { describe, expect, it } from "vitest";
import { Prisma } from "@abp/database";
import { computePaymentSchedule } from "./payment-schedule.js";

describe("computePaymentSchedule", () => {
  it("matches the spec example exactly: 40% advance + 4 equal cheques on 2,508,000.00", () => {
    const result = computePaymentSchedule({
      advancePct: new Prisma.Decimal("40"),
      installments: 4,
      frequencyDays: 30,
      referenceDate: new Date("2026-10-01T00:00:00.000Z"),
      paymentMethod: "CHEQUE",
      grandTotal: new Prisma.Decimal("2508000.00"),
    });

    expect(result.rows[0]?.amount).toBe("1003200.00");
    expect(result.rows.slice(1).map((r) => r.amount)).toEqual([
      "376200.00",
      "376200.00",
      "376200.00",
      "376200.00",
    ]);
    expect(result.rows.slice(1).map((r) => r.dueDate)).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-30",
      "2027-01-29",
    ]);
    expect(result.prose).toBe(
      "Payment Terms: 40% in advance (1,003,200.00). The remaining 60% shall be paid through 4 equal post-dated cheques as follows: 376,200.00 after 30 days from the delivery date, 376,200.00 after 60 days, 376,200.00 after 90 days, and 376,200.00 after 120 days from the delivery date.",
    );
  });

  it("always sums exactly to the grand total, even with an uneven split", () => {
    const grandTotal = new Prisma.Decimal("1000000.33");
    const result = computePaymentSchedule({
      advancePct: new Prisma.Decimal("33"),
      installments: 3,
      frequencyDays: 45,
      referenceDate: null,
      paymentMethod: "BANK_TRANSFER",
      grandTotal,
    });
    const sum = result.rows.reduce(
      (acc, row) => acc.plus(new Prisma.Decimal(row.amount)),
      new Prisma.Decimal(0),
    );
    expect(sum.toFixed(2)).toBe(grandTotal.toFixed(2));
  });

  it("leaves installment due dates null when no reference date is given", () => {
    const result = computePaymentSchedule({
      advancePct: new Prisma.Decimal("50"),
      installments: 2,
      frequencyDays: 30,
      referenceDate: null,
      paymentMethod: "CHEQUE",
      grandTotal: new Prisma.Decimal("100000"),
    });
    expect(result.rows.every((row) => row.dueDate === null)).toBe(true);
  });

  it("handles a single installment without an 'and' in the prose", () => {
    const result = computePaymentSchedule({
      advancePct: new Prisma.Decimal("50"),
      installments: 1,
      frequencyDays: 60,
      referenceDate: null,
      paymentMethod: "CHEQUE",
      grandTotal: new Prisma.Decimal("200000"),
    });
    expect(result.prose).not.toContain(", and");
    expect(result.rows[1]?.amount).toBe("100000.00");
  });
});
