import { describe, expect, it } from "vitest";
import {
  canMoveWorkOrder,
  moveRequirements,
  orderStatusFromWork,
  plannedEnd,
  productionDays,
  scheduleRisk,
} from "./work-order-flow.js";

describe("work order route", () => {
  it("runs planned to completed through QC", () => {
    expect(canMoveWorkOrder("PLANNED", "RELEASED")).toBe(true);
    expect(canMoveWorkOrder("RELEASED", "IN_PROGRESS")).toBe(true);
    expect(canMoveWorkOrder("IN_PROGRESS", "QC")).toBe(true);
    expect(canMoveWorkOrder("QC", "COMPLETED")).toBe(true);
    expect(canMoveWorkOrder("IN_PROGRESS", "COMPLETED")).toBe(false);
    expect(canMoveWorkOrder("COMPLETED", "IN_PROGRESS")).toBe(false);
  });

  it("asks for what each move needs", () => {
    expect(moveRequirements("PLANNED", "CANCELLED", {})).toEqual(["reason"]);
    expect(moveRequirements("IN_PROGRESS", "QC", {})).toEqual([
      "quantityProduced",
    ]);
    expect(
      moveRequirements("QC", "COMPLETED", { qcResultCode: "PASS" }),
    ).toEqual([]);
    expect(
      moveRequirements("QC", "COMPLETED", { qcResultCode: "CONDITIONAL" }),
    ).toEqual(["qcNotes"]);
    expect(
      moveRequirements("QC", "COMPLETED", {
        qcResultCode: "FAIL",
        qcNotes: "edge swelling",
      }),
    ).toEqual(["qcResultCode"]);
    expect(
      moveRequirements("QC", "IN_PROGRESS", {
        qcResultCode: "FAIL",
        qcNotes: "edge swelling",
      }),
    ).toEqual([]);
  });
});

describe("scheduling", () => {
  it("turns boards and a rate into whole days", () => {
    expect(productionDays(3000, 900)).toBe(4);
    expect(productionDays(900, 900)).toBe(1);
    expect(productionDays(3000, null)).toBe(1);
    expect(plannedEnd("2026-10-04", 4)).toBe("2026-10-07");
  });

  it("flags work that cannot reach the customer in time", () => {
    const base = { status: "RELEASED", today: "2026-10-03" };
    expect(
      scheduleRisk({
        ...base,
        plannedEnd: "2026-10-07",
        requestedDelivery: "2026-10-15",
      }),
    ).toBe("ON_TIME");
    expect(
      scheduleRisk({
        ...base,
        plannedEnd: "2026-10-14",
        requestedDelivery: "2026-10-15",
      }),
    ).toBe("LATE_FOR_CUSTOMER");
    expect(
      scheduleRisk({
        ...base,
        plannedEnd: "2026-10-01",
        requestedDelivery: null,
      }),
    ).toBe("OVERDUE");
    expect(
      scheduleRisk({
        ...base,
        status: "COMPLETED",
        plannedEnd: "2026-10-01",
        requestedDelivery: null,
      }),
    ).toBe("DONE");
  });
});

describe("orderStatusFromWork", () => {
  it("starts production with the first work order and readies the order with the last", () => {
    expect(orderStatusFromWork("CONFIRMED", ["IN_PROGRESS", "PLANNED"])).toBe(
      "IN_PRODUCTION",
    );
    expect(
      orderStatusFromWork("IN_PRODUCTION", ["COMPLETED", "QC"]),
    ).toBeNull();
    expect(
      orderStatusFromWork("IN_PRODUCTION", ["COMPLETED", "CANCELLED"]),
    ).toBe("READY");
    expect(orderStatusFromWork("CONFIRMED", ["COMPLETED"])).toBe("READY");
    expect(orderStatusFromWork("READY", ["COMPLETED"])).toBeNull();
    expect(orderStatusFromWork("CONFIRMED", ["CANCELLED"])).toBeNull();
  });
});
