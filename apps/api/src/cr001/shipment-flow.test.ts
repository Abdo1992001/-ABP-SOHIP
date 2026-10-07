import { describe, expect, it } from "vitest";
import {
  allDelivered,
  isNextStep,
  nextAction,
  nextMilestone,
  normaliseUnits,
} from "./shipment-flow.js";

describe("shipment route", () => {
  it("takes a truck straight from dispatch to delivery", () => {
    expect(nextMilestone("LOCAL_TRUCK", "READY_FOR_DELIVERY")).toBe("SHIPPED");
    expect(nextMilestone("LOCAL_TRUCK", "SHIPPED")).toBe("DELIVERED");
    expect(nextMilestone("LOCAL_TRUCK", "DELIVERED")).toBe("POD_RECEIVED");
    expect(nextMilestone("LOCAL_TRUCK", "POD_RECEIVED")).toBeNull();
    expect(isNextStep("LOCAL_TRUCK", "SHIPPED", "VESSEL_DEPARTED")).toBe(false);
  });

  it("takes a container through the vessel and the port first", () => {
    expect(nextAction("SEA_CONTAINER", "READY_FOR_DELIVERY")).toBe("DISPATCH");
    expect(nextAction("SEA_CONTAINER", "SHIPPED")).toBe("VESSEL_DEPARTED");
    expect(nextAction("SEA_CONTAINER", "VESSEL_DEPARTED")).toBe("ARRIVED");
    expect(nextAction("SEA_CONTAINER", "ARRIVED_AT_PORT_OF_DISCHARGE")).toBe(
      "DELIVER",
    );
    expect(nextAction("SEA_CONTAINER", "DELIVERED")).toBe("POD");
    expect(isNextStep("SEA_CONTAINER", "SHIPPED", "DELIVERED")).toBe(false);
  });

  it("treats an unknown mode as the export route", () => {
    expect(nextMilestone("", "SHIPPED")).toBe("VESSEL_DEPARTED");
  });
});

describe("allDelivered", () => {
  it("needs every shipment delivered, and at least one", () => {
    expect(allDelivered([])).toBe(false);
    expect(allDelivered(["DELIVERED", "POD_RECEIVED"])).toBe(true);
    expect(allDelivered(["DELIVERED", "SHIPPED"])).toBe(false);
  });
});

describe("normaliseUnits", () => {
  it("drops unknown or empty units and merges the rest", () => {
    expect(
      normaliseUnits([
        { typeCode: "CONTAINER_20", count: 2 },
        { typeCode: "CONTAINER_40", count: 7 },
        { typeCode: "CONTAINER_20", count: 1 },
        { typeCode: "BARGE", count: 1 },
        { typeCode: "TRUCK", count: 0 },
      ]),
    ).toEqual([
      { typeCode: "CONTAINER_40", count: 7 },
      { typeCode: "CONTAINER_20", count: 3 },
    ]);
  });
});
