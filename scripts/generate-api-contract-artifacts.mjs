import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
import prettier from "prettier";
import YAML from "yaml";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const openapiPath = path.join(
  repositoryRoot,
  "docs/contracts/openapi/openapi.yaml",
);
const outOfScopePath = path.join(
  repositoryRoot,
  "docs/contracts/out-of-scope-v1.yaml",
);
const generatedClientPath = path.join(
  repositoryRoot,
  "packages/api-client/src/generated/schema.ts",
);
const inventoryJsonPath = path.join(
  repositoryRoot,
  "docs/contracts/api-inventory.json",
);
const inventoryMarkdownPath = path.join(
  repositoryRoot,
  "docs/contracts/api-inventory.md",
);
const evidencePath = path.join(
  repositoryRoot,
  "docs/contracts/contract-evidence.json",
);
const runtimeManifestPath = path.join(
  repositoryRoot,
  "docs/contracts/runtime-v1-operations.json",
);
const apiClientPackagePath = path.join(
  repositoryRoot,
  "packages/api-client/package.json",
);

const mode = process.argv.includes("--write") ? "write" : "check";
const api = await SwaggerParser.bundle(openapiPath);
const apiClientPackage = JSON.parse(
  await fs.readFile(apiClientPackagePath, "utf8"),
);
const contractVersion = api.info.version;
if (apiClientPackage.version !== contractVersion) {
  throw new Error(
    `API_CLIENT_VERSION_MISMATCH: contract=${contractVersion} client=${String(apiClientPackage.version)}`,
  );
}
const canonicalOpenApi = JSON.stringify(sortDeep(api));
const openapiHash = sha256(canonicalOpenApi);
const ast = await openapiTS(pathToFileURL(openapiPath), {
  alphabetize: true,
  immutable: true,
  exportType: true,
});
const generatedClient = `${COMMENT_HEADER}// ABP API contract ${contractVersion}; canonical OpenAPI SHA-256: ${openapiHash}\n${astToString(ast)}`;
const generatedClientHash = sha256(generatedClient);
const outOfScopeSource = YAML.parse(await fs.readFile(outOfScopePath, "utf8"));
const inventory = buildInventory(api, outOfScopeSource.operations);
const inventoryJson = await prettier.format(
  JSON.stringify(inventory, null, 2),
  {
    parser: "json",
  },
);
const inventoryMarkdown = buildInventoryMarkdown(inventory);
const statusCounts = inventory.reduce((counts, operation) => {
  counts[operation.implementationStatus] =
    (counts[operation.implementationStatus] ?? 0) + 1;
  return counts;
}, {});
const evidence = {
  contractVersion: api.info.version,
  openapiOperations: inventory.filter(
    (operation) => operation.implementationStatus !== "OUT_OF_SCOPE_V1",
  ).length,
  inventoryOperations: inventory.length,
  statusCounts,
  openapiSha256: openapiHash,
  generatedClientSha256: generatedClientHash,
  generatedClientPackage: `@abp/api-client@${contractVersion}`,
};
const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`;
const runtimeManifest = await prettier.format(
  JSON.stringify(
    inventory
      .filter((operation) => operation.implementationStatus === "IMPLEMENTED")
      .map(({ method, path: operationPath, operationId }) => ({
        method,
        path: operationPath,
        operationId,
      })),
    null,
    2,
  ),
  { parser: "json" },
);

const artifacts = [
  [generatedClientPath, generatedClient],
  [inventoryJsonPath, inventoryJson],
  [inventoryMarkdownPath, inventoryMarkdown],
  [evidencePath, evidenceJson],
  [runtimeManifestPath, runtimeManifest],
];

if (mode === "write") {
  for (const [target, contents] of artifacts) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  console.info(
    JSON.stringify({
      result: "GENERATED",
      openapiHash,
      generatedClientHash,
      operations: evidence.openapiOperations,
    }),
  );
} else {
  const drift = [];
  for (const [target, expected] of artifacts) {
    const actual = await fs.readFile(target, "utf8").catch(() => "");
    if (actual !== expected) {
      drift.push(path.relative(repositoryRoot, target).replaceAll("\\", "/"));
    }
  }
  if (drift.length > 0) {
    console.error(
      JSON.stringify({ result: "GENERATED_ARTIFACT_DRIFT", drift }),
    );
    process.exitCode = 1;
  } else {
    console.info(
      JSON.stringify({
        result: "NO_GENERATED_ARTIFACT_DRIFT",
        openapiHash,
        generatedClientHash,
      }),
    );
  }
}

function buildInventory(document, outOfScopeOperations) {
  const operations = [];
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  for (const pathName of Object.keys(document.paths).sort()) {
    const pathItem = document.paths[pathName];
    for (const method of Object.keys(pathItem).filter((key) =>
      methods.has(key),
    )) {
      const operation = pathItem[method];
      operations.push({
        module: operation["x-abp-module"],
        method: method.toUpperCase(),
        path: pathName,
        operationId: operation.operationId,
        requestType: operation["x-abp-request-schema"],
        successResponse: operation["x-abp-success-schema"],
        errorResponses: Object.keys(operation.responses)
          .filter((status) => Number(status) >= 400)
          .sort(),
        permissionCode: operation["x-abp-permission"],
        countryScopeRequirement: operation["x-abp-scope-rule"],
        concurrencyRequirement: operation["x-abp-concurrency"],
        idempotencyRequirement: operation["x-abp-idempotency"],
        executionMode: operation["x-abp-execution-mode"],
        jobDtoUsage: operation["x-abp-job-dto"],
        implementationStatus: operation["x-implementation-status"],
        runtimeEnabled: operation["x-runtime-enabled"],
      });
    }
  }
  for (const operation of outOfScopeOperations) {
    operations.push({
      module: operation.module,
      method: operation.method,
      path: operation.path,
      operationId: null,
      requestType: null,
      successResponse: null,
      errorResponses: [],
      permissionCode: null,
      countryScopeRequirement: null,
      concurrencyRequirement: null,
      idempotencyRequirement: null,
      executionMode: null,
      jobDtoUsage: false,
      implementationStatus: "OUT_OF_SCOPE_V1",
      runtimeEnabled: false,
      reason: operation.reason,
    });
  }
  return operations.sort((left, right) =>
    `${left.implementationStatus}|${left.module}|${left.path}|${left.method}`.localeCompare(
      `${right.implementationStatus}|${right.module}|${right.path}|${right.method}`,
    ),
  );
}

function buildInventoryMarkdown(inventory) {
  const lines = [
    "# ABP V1 API inventory",
    "",
    "Generated from the authoritative OpenAPI 3.1 contract. Do not edit manually.",
    "",
    "| Status | Module | Method | Path | operationId | Request | Success | Permission | Scope | Concurrency | Mode | Job |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const operation of inventory) {
    lines.push(
      `| ${cell(operation.implementationStatus)} | ${cell(operation.module)} | ${cell(operation.method)} | ${cell(operation.path)} | ${cell(operation.operationId)} | ${cell(operation.requestType)} | ${cell(operation.successResponse)} | ${cell(operation.permissionCode)} | ${cell(operation.countryScopeRequirement ?? operation.reason)} | ${cell(operation.concurrencyRequirement)} | ${cell(operation.executionMode)} | ${operation.jobDtoUsage ? "YES" : "NO"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function cell(value) {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
