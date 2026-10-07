import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret } from "./mfa-crypto.js";

describe("local MFA secret encryption", () => {
  afterEach(() => delete process.env.ABP_MFA_MASTER_KEY);

  it("round-trips through AES-256-GCM without plaintext storage", () => {
    process.env.ABP_MFA_MASTER_KEY = randomBytes(32).toString("base64");
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it("fails closed without a 256-bit master key", () => {
    process.env.ABP_MFA_MASTER_KEY = "invalid";
    expect(() => encryptMfaSecret("secret")).toThrow(
      "ABP_MFA_MASTER_KEY_INVALID",
    );
  });
});
