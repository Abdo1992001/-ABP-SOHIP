import { describe, expect, it } from "vitest";
import {
  allowedNext,
  canAmend,
  canMove,
  isOrderStatus,
  orderTotals,
  quotationVatRate,
  round2,
} from "./order-lifecycle.js";

describe("order lifecycle", () => {
  it("moves forward one step, with the stock shortcut to ready", () => {
    expect(canMove("DRAFT", "CONFIRMED")).toBe(true);
    expect(canMove("CONFIRMED", "IN_PRODUCTION")).toBe(true);
    expect(canMove("CONFIRMED", "READY")).toBe(true);
    expect(canMove("READY", "HANDED_OVER")).toBe(true);
    expect(canMove("HANDED_OVER", "CLOSED")).toBe(true);
  });
  it("does not skip confirmation or come back from the end", () => {
    expect(canMove("DRAFT", "READY")).toBe(false);
    expect(canMove("CLOSED", "CONFIRMED")).toBe(false);
    expect(canMove("CANCELLED", "DRAFT")).toBe(false);
    expect(allowedNext("CLOSED")).toEqual([]);
  });
  it("can be cancelled until it has left the yard", () => {
    expect(canMove("READY", "CANCELLED")).toBe(true);
    expect(canMove("HANDED_OVER", "CANCELLED")).toBe(false);
  });
  it("can be amended only before production", () => {
    expect(canAmend("DRAFT")).toBe(true);
    expect(canAmend("CONFIRMED")).toBe(true);
    expect(canAmend("IN_PRODUCTION")).toBe(false);
  });
  it("knows its statuses", () => {
    expect(isOrderStatus("READY")).toBe(true);
    expect(isOrderStatus("SHIPPED")).toBe(false);
  });
});

describe("order money", () => {
  it("rounds half away from zero to the piastre", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
  });
  it("recovers the quotation's VAT rate from its own totals", () => {
    // The demo quotation: 9,318,566.70 + 1,304,599.34 = 10,623,166.04.
    expect(quotationVatRate(9318566.7, 1304599.34, 10623166.04)).toBe(0.14);
  });
  it("totals the lines, the adjustment and VAT as the quotation did", () => {
    expect(orderTotals([3000000, 1566898.5], 0, 0.14)).toEqual({
      subtotal: 4566898.5,
      tax: 639365.79,
      total: 5206264.29,
    });
    // Freight of 10,000 is taxed with the goods.
    expect(orderTotals([1000], 10000, 0.14)).toEqual({
      subtotal: 1000,
      tax: 1540,
      total: 12540,
    });
  });
});
