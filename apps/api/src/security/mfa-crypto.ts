import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
}

export function encryptMfaSecret(secret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    version: 1,
  };
}

export function decryptMfaSecret(value: EncryptedSecret): string {
  if (value.version !== 1) throw new Error("MFA_SECRET_VERSION_UNSUPPORTED");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function masterKey(): Buffer {
  const raw = process.env.ABP_MFA_MASTER_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ABP_MFA_MASTER_KEY_INVALID");
  return key;
}
