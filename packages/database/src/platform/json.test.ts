import { describe, expect, it } from "vitest";
import { toSafeJson } from "./json.js";

describe("safe platform JSON", () => {
  it("redacts secret-bearing keys recursively", () => {
    expect(
      toSafeJson(
        {
          displayName: "Synthetic User",
          password: "never-store-this",
          nested: { accessToken: "never-store-this-either", allowed: true },
        },
        true,
      ),
    ).toEqual({
      displayName: "Synthetic User",
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", allowed: true },
    });
  });
});
