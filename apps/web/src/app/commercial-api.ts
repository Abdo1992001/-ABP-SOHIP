import type { ApiClient } from "@abp/api-client";
import {
  executeOperation,
  operationCatalog,
  type ExecuteOperationInput,
} from "../api/operation-runtime.ts";

export function commercialOperation(method: string, path: string) {
  const operation = operationCatalog.find(
    (item) => item.method === method && item.path === path,
  );
  if (!operation) throw new Error(`Unsupported operation: ${method} ${path}`);
  return operation;
}
export async function commercialRequest(
  client: ApiClient,
  method: string,
  path: string,
  input: ExecuteOperationInput = { path: {} },
) {
  return executeOperation(client, commercialOperation(method, path), input);
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isObject);
  if (isObject(value)) return rows(value.data);
  return [];
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "—";
}
