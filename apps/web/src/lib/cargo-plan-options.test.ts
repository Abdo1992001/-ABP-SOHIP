import { describe, expect, it } from "vitest";
import {
  boardsAsItems,
  planOptions,
  recommendedOption,
} from "./cargo-plan-options.ts";
import type { CargoItem } from "./cargo-packing.ts";

/**
 * A bundle of ACROW board is roughly 2.44 m long, 1.22 m wide and a metre
 * high at about 1.1 tonnes, which is what these use. What matters is that
 * every option comes from actually packing the shipment — dividing a volume
 * by a container's volume would count boards that do not fit.
 */

const bundle = (quantity: number, id = "b1"): CargoItem => ({
  id,
  label: "ACROW Board 18 × 1220 × 2440 bundle",
  lengthMm: 2440,
  widthMm: 1220,
  heightMm: 1000,
  weightKg: 1100,
  quantity,
});

describe("what plans are offered", () => {
  it("offers a plan per sea container, and the mixes", () => {
    const options = planOptions({ items: [bundle(30)], mode: "SEA" });
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) expect(option.totalUnits).toBeGreaterThan(0);
  });

  it("offers nothing for an empty shipment", () => {
    expect(planOptions({ items: [], mode: "SEA" })).toEqual([]);
  });

  it("keeps road units out of a sea plan", () => {
    const options = planOptions({ items: [bundle(20)], mode: "SEA" });
    for (const option of options)
      for (const unit of option.units) expect(unit.container.kind).toBe("SEA");
  });

  it("plans a road shipment out of road units", () => {
    const options = planOptions({ items: [bundle(8)], mode: "ROAD" });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options)
      for (const unit of option.units) expect(unit.container.kind).toBe("ROAD");
  });

  it("can be held to one container type", () => {
    const options = planOptions({
      items: [bundle(30)],
      mode: "SEA",
      containerCodes: ["ABP40"],
    });
    for (const option of options)
      for (const unit of option.units) expect(unit.containerCode).toBe("ABP40");
  });
});

describe("how the options are ranked", () => {
  it("puts the fewest containers first", () => {
    const options = planOptions({ items: [bundle(40)], mode: "SEA" });
    for (let i = 1; i < options.length; i += 1) {
      const previous = options[i - 1];
      const current = options[i];
      if (previous === undefined || current === undefined) continue;
      if (previous.complete === current.complete)
        expect(previous.totalUnits).toBeLessThanOrEqual(current.totalUnits);
    }
  });

  it("recommends a plan that carries everything", () => {
    const options = planOptions({ items: [bundle(25)], mode: "SEA" });
    const best = recommendedOption(options);
    expect(best?.complete).toBe(true);
    expect(best?.refused).toEqual([]);
  });

  it("never recommends leaving boards behind to save a container", () => {
    const options = planOptions({ items: [bundle(25)], mode: "SEA" });
    const incomplete = options.filter((option) => !option.complete);
    const complete = options.filter((option) => option.complete);
    const firstIncomplete = incomplete[0];
    const lastComplete = complete[complete.length - 1];
    if (firstIncomplete !== undefined && lastComplete !== undefined)
      expect(options.indexOf(lastComplete)).toBeLessThan(
        options.indexOf(firstIncomplete),
      );
  });
});

describe("what each plan reports", () => {
  it("counts how many of each container it books", () => {
    const options = planOptions({ items: [bundle(30)], mode: "SEA" });
    const best = recommendedOption(options);
    const counted = (best?.mix ?? []).reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    expect(counted).toBe(best?.totalUnits);
  });

  it("reports the weight it is actually carrying", () => {
    const options = planOptions({ items: [bundle(20)], mode: "SEA" });
    const best = recommendedOption(options);
    // 20 bundles at 1,100 kg, less anything the plan could not place.
    const placed = 20 - (best?.refused[0]?.quantity ?? 0);
    expect(best?.totalWeightKg).toBeCloseTo(placed * 1100, 0);
  });

  it("reports utilisation as a share, never above one", () => {
    for (const option of planOptions({ items: [bundle(30)], mode: "SEA" })) {
      expect(option.payloadUse).toBeGreaterThan(0);
      expect(option.payloadUse).toBeLessThanOrEqual(1);
      expect(option.volumeUse).toBeGreaterThan(0);
      expect(option.volumeUse).toBeLessThanOrEqual(1);
    }
  });

  it("respects the payload limit on every container it books", () => {
    // 25 tonnes is the working limit; a plan that overloads one is not a plan.
    for (const option of planOptions({ items: [bundle(60)], mode: "SEA" }))
      for (const unit of option.units)
        expect(unit.loaded.weightKg).toBeLessThanOrEqual(
          unit.container.payloadKg,
        );
  });

  it("carries the same total weight whichever plan is chosen", () => {
    const options = planOptions({ items: [bundle(25)], mode: "SEA" }).filter(
      (option) => option.complete,
    );
    const weights = new Set(
      options.map((option) => Math.round(option.totalWeightKg)),
    );
    expect(weights.size).toBe(1);
  });
});

describe("how many boards went in each container", () => {
  const board = {
    label: "ACROW Board 18 × 1220 × 2440 (M Board)",
    lengthMm: 2440,
    widthMm: 1220,
    thicknessMm: 18,
    weightKg: 33,
  };

  it("counts loose boards one for one", () => {
    const { items, boardsPerItem } = boardsAsItems(board, 120, "BOARDS");
    const options = planOptions({
      items,
      boardsPerItem,
      mode: "ROAD",
      containerCodes: ["TRAILER13"],
    });
    expect(options[0]?.totalBoards).toBe(120);
  });

  it("counts the boards inside each bundle, not the bundles", () => {
    const { items, boardsPerItem } = boardsAsItems(board, 120, "BUNDLES");
    const options = planOptions({
      items,
      boardsPerItem,
      mode: "ROAD",
      containerCodes: ["TRAILER13"],
    });
    // 120 boards is three bundles of 35 and a tail of 15.
    expect(options[0]?.totalBoards).toBe(120);
  });

  it("splits the board count across the containers it booked", () => {
    const { items, boardsPerItem } = boardsAsItems(board, 700, "BUNDLES");
    const option = planOptions({
      items,
      boardsPerItem,
      mode: "ROAD",
      containerCodes: ["JUMBO4"],
    })[0];
    const summed = (option?.units ?? []).reduce(
      (sum, unit) => sum + unit.boards,
      0,
    );
    expect(summed).toBe(option?.totalBoards);
    expect(summed).toBeGreaterThan(0);
  });

  it("loses no board to the tail bundle", () => {
    // 103 is three full bundles and a tail of three boards.
    const { boardsPerItem, items } = boardsAsItems(board, 103, "BUNDLES");
    const counted = items.reduce(
      (sum, item) => sum + (boardsPerItem[item.id] ?? 0) * item.quantity,
      0,
    );
    expect(counted).toBe(103);
  });

  it("reports the capacities ABP states for its own road fleet", () => {
    for (const [code, stated] of [
      ["JUMBO4", 150],
      ["JUMBO6", 200],
      ["TRAILER13", 700],
    ] as const) {
      const { items, boardsPerItem } = boardsAsItems(board, stated, "BOARDS");
      const option = planOptions({
        items,
        boardsPerItem,
        mode: "ROAD",
        containerCodes: [code],
      })[0];
      expect(option?.totalUnits, `${code} should take ${String(stated)}`).toBe(
        1,
      );
      expect(option?.totalBoards).toBe(stated);
    }
  });
});
