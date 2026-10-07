import { describe, expect, it } from "vitest";
import {
  findMove,
  isLate,
  missingFields,
  movesFor,
  stageDueAt,
} from "./complaint-flow.js";

const sales = new Set(["complaints.view", "complaints.edit"]);
const ops = new Set(["complaints.view", "complaints.operations-review"]);
const quality = new Set(["complaints.view", "complaints.quality-review"]);
const manager = new Set([
  "complaints.view",
  "complaints.edit",
  "complaints.close",
]);

describe("complaint route", () => {
  it("lets sales hand a new complaint to operations, and nothing else", () => {
    expect(movesFor("OPEN", sales, false).map((m) => m.to)).toEqual([
      "OPERATIONS_REVIEW",
    ]);
    expect(movesFor("OPEN", quality, false)).toEqual([]);
  });

  it("gives operations quality, a direct solution, or a return to sales", () => {
    expect(movesFor("OPERATIONS_REVIEW", ops, false).map((m) => m.to)).toEqual([
      "QUALITY_REVIEW",
      "SOLUTION",
      "OPEN",
    ]);
    expect(movesFor("OPERATIONS_REVIEW", sales, false)).toEqual([]);
  });

  it("only quality closes its own review", () => {
    expect(movesFor("QUALITY_REVIEW", quality, false).map((m) => m.to)).toEqual(
      ["SOLUTION", "OPERATIONS_REVIEW"],
    );
    expect(movesFor("QUALITY_REVIEW", ops, false)).toEqual([]);
  });

  it("lets the solution owner resolve without any complaint permission", () => {
    expect(movesFor("SOLUTION", new Set(), true).map((m) => m.to)).toEqual([
      "RESOLVED",
    ]);
    expect(movesFor("SOLUTION", new Set(), false)).toEqual([]);
  });

  it("closes only with the close permission", () => {
    expect(movesFor("RESOLVED", sales, false).map((m) => m.to)).toEqual([
      "SOLUTION",
    ]);
    expect(movesFor("RESOLVED", manager, false).map((m) => m.to)).toEqual([
      "CLOSED",
      "SOLUTION",
    ]);
    expect(movesFor("CLOSED", manager, false)).toEqual([]);
  });

  it("refuses moves that skip stages, and legacy statuses", () => {
    expect(findMove("OPEN", "CLOSED")).toBeUndefined();
    expect(findMove("IN_PROGRESS", "RESOLVED")).toBeUndefined();
  });
});

describe("what must be on record", () => {
  it("asks quality for the cause and the plan before a solution", () => {
    const move = findMove("QUALITY_REVIEW", "SOLUTION");
    if (!move) throw new Error("missing move");
    expect(missingFields(move, { rootCauseCode: "PRODUCTION" })).toEqual([
      "rootCauseDetail",
      "correctiveAction",
      "solutionOwnerUserId",
      "solutionDueDate",
    ]);
  });

  it("asks for a real reason on a step back", () => {
    const move = findMove("RESOLVED", "SOLUTION");
    if (!move) throw new Error("missing move");
    expect(missingFields(move, { reason: "no" })).toEqual(["reason"]);
    expect(
      missingFields(move, { reason: "Customer still sees warping" }),
    ).toEqual([]);
  });
});

describe("stage deadlines", () => {
  const at = new Date("2026-10-02T09:00:00Z");
  it("gives operations two days, half that for a critical case", () => {
    expect(
      stageDueAt({
        stage: "OPERATIONS_REVIEW",
        enteredAt: at,
        severityCode: "MEDIUM",
      })?.toISOString(),
    ).toBe("2026-10-04T09:00:00.000Z");
    expect(
      stageDueAt({
        stage: "OPERATIONS_REVIEW",
        enteredAt: at,
        severityCode: "CRITICAL",
      })?.toISOString(),
    ).toBe("2026-10-03T09:00:00.000Z");
  });
  it("holds the solution to the owner's own date", () => {
    expect(
      stageDueAt({
        stage: "SOLUTION",
        enteredAt: at,
        severityCode: null,
        solutionDueDate: "2026-10-20",
      })?.toISOString(),
    ).toBe("2026-10-20T23:59:59.000Z");
    expect(
      stageDueAt({ stage: "CLOSED", enteredAt: at, severityCode: null }),
    ).toBeNull();
  });
  it("is late only after the deadline and never once closed", () => {
    const due = new Date("2026-10-04T09:00:00Z");
    expect(
      isLate(due, "OPERATIONS_REVIEW", new Date("2026-10-05T00:00:00Z")),
    ).toBe(true);
    expect(
      isLate(due, "OPERATIONS_REVIEW", new Date("2026-10-03T00:00:00Z")),
    ).toBe(false);
    expect(isLate(due, "CLOSED", new Date("2026-10-05T00:00:00Z"))).toBe(false);
  });
});
