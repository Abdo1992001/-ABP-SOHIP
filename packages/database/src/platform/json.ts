import type { Prisma } from "../generated/prisma/client.js";

const redactedValue = "[REDACTED]";
const sensitiveKeyPattern =
  /password|passphrase|token|cookie|authorization|secret|api[-_]?key|session[-_]?key/i;

export type SafeJsonValue =
  | string
  | number
  | boolean
  | null
  | SafeJsonValue[]
  | { [key: string]: SafeJsonValue };

export function toSafeJson(
  value: unknown,
  redactSensitive = false,
): SafeJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSafeJson(item, redactSensitive));
  }
  if (typeof value === "object") {
    const result: { [key: string]: SafeJsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        continue;
      }
      result[key] =
        redactSensitive && sensitiveKeyPattern.test(key)
          ? redactedValue
          : toSafeJson(item, redactSensitive);
    }
    return result;
  }
  if (typeof value === "symbol") {
    return value.description ?? "[Symbol]";
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  return "[Unsupported]";
}

export function toInputJson(
  value: Readonly<Record<string, unknown>>,
  redactSensitive = false,
): Prisma.InputJsonValue {
  return toSafeJson(value, redactSensitive) as Prisma.InputJsonValue;
}

export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const possibleCode = (error as Error & { code?: unknown }).code;
    return {
      code: typeof possibleCode === "string" ? possibleCode : "UNHANDLED_ERROR",
      message: error.message.slice(0, 1000),
    };
  }
  return { code: "UNHANDLED_ERROR", message: String(error).slice(0, 1000) };
}
