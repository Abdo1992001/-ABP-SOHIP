import { describe, expect, it } from "vitest";
import {
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password.service.js";

describe("local Argon2id password service", () => {
  it("hashes and verifies the correct password without storing plaintext", async () => {
    const password = "Correct-Horse-ABP-2026!";
    const encoded = await hashPassword(password);
    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(encoded, password)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const encoded = await hashPassword("Correct-Horse-ABP-2026!");
    await expect(
      verifyPassword(encoded, "Wrong-Horse-ABP-2026!"),
    ).resolves.toBe(false);
  });

  it("detects hashes that need rehashing", async () => {
    const encoded = await hashPassword("Correct-Horse-ABP-2026!");
    expect(needsRehash(encoded)).toBe(false);
    expect(needsRehash("not-a-password-hash")).toBe(true);
  });
});
