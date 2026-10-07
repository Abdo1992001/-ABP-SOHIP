import { describe, expect, it } from "vitest";
import { getLivenessResponse, getReadinessResponse } from "./health.js";

describe("health contract", () => {
  it("reports process liveness without dependency details", () => {
    expect(getLivenessResponse(new Date("2026-08-21T00:00:00.000Z"))).toEqual({
      data: {
        status: "UP",
        timestamp: "2026-08-21T00:00:00.000Z",
        checks: [],
      },
    });
  });

  it("reports PostgreSQL readiness without infrastructure details", () => {
    expect(
      getReadinessResponse(false, new Date("2026-08-21T00:00:00.000Z")),
    ).toEqual({
      data: {
        status: "DOWN",
        timestamp: "2026-08-21T00:00:00.000Z",
        checks: [{ name: "postgresql", status: "DOWN" }],
      },
    });
  });
});
