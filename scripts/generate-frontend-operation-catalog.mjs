import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";

const root = resolve(import.meta.dirname, "..");
const inventory = JSON.parse(
  await readFile(resolve(root, "docs/contracts/api-inventory.json"), "utf8"),
);
const openapi = await SwaggerParser.dereference(
  resolve(root, "docs/contracts/openapi/openapi.yaml"),
);
const runtimeOperations = new Map();
for (const [pathName, pathItem] of Object.entries(openapi.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem?.[method];
    if (operation?.operationId)
      runtimeOperations.set(operation.operationId, {
        pathName,
        method,
        operation,
      });
  }
}
const operations = inventory
  .filter(
    (item) =>
      item.runtimeEnabled === true &&
      item.implementationStatus === "IMPLEMENTED" &&
      typeof item.operationId === "string" &&
      item.operationId.length > 0,
  )
  .map((item) => ({
    operationId: item.operationId,
    module: item.module,
    method: item.method,
    path: item.path,
    permission: item.permissionCode,
    queryParameters: (
      runtimeOperations.get(item.operationId)?.operation?.parameters ?? []
    )
      .filter((parameter) => parameter.in === "query")
      .map((parameter) => parameter.name),
    requestType: item.requestType,
    successResponse: item.successResponse,
    executionMode: item.executionMode,
    concurrency: item.concurrencyRequirement,
    // Carried through so the runtime can supply the key itself. It was
    // dropped here, so the frontend had no way to know a command needed
    // one and every call site had to remember -- two did not, and failed
    // with a 400 only when somebody pressed the button.
    idempotency: item.idempotencyRequirement ?? "NONE",
    countryScope: item.countryScopeRequirement,
    job: item.jobDtoUsage === true,
    requestSchema: requestShape(
      runtimeOperations.get(item.operationId)?.operation?.requestBody
        ?.content?.["application/json"]?.schema,
    ),
  }))
  .sort((left, right) => left.operationId.localeCompare(right.operationId));

const target = resolve(root, "apps/web/src/generated/operation-catalog.json");
await mkdir(resolve(target, ".."), { recursive: true });
await writeFile(
  target,
  `${JSON.stringify({ version: 1, operations }, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", operations: operations.length, target })}\n`,
);

function requestShape(schema, depth = 0) {
  if (!schema || depth > 8) return null;
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf
      .map((part) => requestShape(part, depth + 1))
      .filter(Boolean);
    return {
      type: "object",
      required: [...new Set(parts.flatMap((part) => part.required ?? []))],
      properties: Object.assign(
        {},
        ...parts.map((part) => part.properties ?? {}),
      ),
    };
  }
  const rawTypes = Array.isArray(schema.type)
    ? schema.type
    : [schema.type ?? "object"];
  const type = rawTypes.find((value) => value !== "null") ?? "string";
  const result = {
    type,
    nullable: rawTypes.includes("null"),
    ...(schema.format ? { format: schema.format } : {}),
    ...(schema.description ? { description: schema.description } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.default !== undefined ? { default: schema.default } : {}),
    ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}),
    ...(schema.maximum !== undefined ? { maximum: schema.maximum } : {}),
    ...(schema.minLength !== undefined ? { minLength: schema.minLength } : {}),
    ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}),
    ...(schema.pattern ? { pattern: schema.pattern } : {}),
  };
  if (type === "object") {
    result.required = schema.required ?? [];
    result.properties = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, value]) => [
        name,
        requestShape(value, depth + 1),
      ]),
    );
  }
  if (type === "array") result.items = requestShape(schema.items, depth + 1);
  return result;
}
