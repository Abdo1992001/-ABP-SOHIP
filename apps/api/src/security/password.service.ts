import {
  Algorithm,
  Version,
  hash,
  parseOptions,
  verify,
} from "@node-rs/argon2";

export interface PasswordPolicy {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  outputLen: number;
}

export function passwordPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): PasswordPolicy {
  return {
    memoryCost: integer(environment.ABP_ARGON2_MEMORY_KIB, 65_536, 19_456),
    timeCost: integer(environment.ABP_ARGON2_TIME_COST, 3, 2),
    parallelism: integer(environment.ABP_ARGON2_PARALLELISM, 1, 1),
    outputLen: 32,
  };
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return hash(password, {
    ...passwordPolicy(),
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
  });
}

export async function verifyPassword(
  encodedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(encodedHash, password, {
      algorithm: Algorithm.Argon2id,
      version: Version.V0x13,
    });
  } catch {
    return false;
  }
}

export function needsRehash(encodedHash: string): boolean {
  try {
    const parsed = parseOptions(encodedHash);
    const policy = passwordPolicy();
    return (
      parsed.algorithm !== Algorithm.Argon2id ||
      parsed.version !== Version.V0x13 ||
      parsed.memoryCost !== policy.memoryCost ||
      parsed.timeCost !== policy.timeCost ||
      parsed.parallelism !== policy.parallelism ||
      parsed.outputLen !== policy.outputLen
    );
  } catch {
    return true;
  }
}

export function validatePassword(password: string): void {
  if (
    password.length < 12 ||
    password.length > 256 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error("PASSWORD_POLICY_REJECTED");
  }
}

function integer(value: string | undefined, fallback: number, minimum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}
