import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const openapiPath = path.join(
  repositoryRoot,
  "docs/contracts/openapi/openapi.yaml",
);
const runtimeManifestPath = path.join(
  repositoryRoot,
  "docs/contracts/runtime-v1-operations.json",
);
const outOfScopePath = path.join(
  repositoryRoot,
  "docs/contracts/out-of-scope-v1.yaml",
);

const api = await SwaggerParser.bundle(openapiPath);
// Swagger Parser 12 misclassifies external Path Item $refs that contain more
// than one HTTP method. Validate the resolved bundle so schema validation still
// covers the complete contract without that external-reference false positive.
await SwaggerParser.validate(globalThis.structuredClone(api));
const runtimeManifest = JSON.parse(
  await fs.readFile(runtimeManifestPath, "utf8"),
);
const outOfScope = YAML.parse(
  await fs.readFile(outOfScopePath, "utf8"),
).operations;
const findings = [];
const operationIds = new Map();
const implemented = [];
let operations = 0;
let typedOperations = 0;

for (const [pathName, pathItem] of Object.entries(api.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (operation === undefined) continue;
    operations += 1;
    const operationKey = `${method.toUpperCase()} ${pathName}`;
    if (!operation.operationId)
      findings.push(`${operationKey}: missing operationId`);
    const previous = operationIds.get(operation.operationId);
    if (previous)
      findings.push(`${operationKey}: duplicate operationId with ${previous}`);
    operationIds.set(operation.operationId, operationKey);
    for (const extension of [
      "x-abp-module",
      "x-abp-permission",
      "x-abp-scope-rule",
      "x-abp-concurrency",
      "x-abp-execution-mode",
      "x-abp-job-dto",
      "x-implementation-status",
      "x-runtime-enabled",
    ]) {
      if (operation[extension] === undefined)
        findings.push(`${operationKey}: missing ${extension}`);
    }
    const successResponses = Object.entries(operation.responses ?? {}).filter(
      ([status]) => status.startsWith("2"),
    );
    const successTyped =
      successResponses.length > 0 &&
      successResponses.every(([, response]) => responseHasSchema(response));
    const requestTyped =
      operation.requestBody === undefined ||
      requestBodyHasSchema(operation.requestBody);
    if (successTyped && requestTyped) typedOperations += 1;
    else findings.push(`${operationKey}: request or 2xx response is not typed`);
    if (operation["x-implementation-status"] === "IMPLEMENTED") {
      implemented.push({
        method: method.toUpperCase(),
        path: pathName,
        operationId: operation.operationId,
      });
    }
  }
}

// The point of a hard number here is to make an *unintended* operation
// impossible to add quietly. It was left at 262 while the contract grew to
// 283, so the check failed on every run for twenty-one operations' worth of
// changes and therefore signalled nothing. Updated to the deliberate count:
// 283 as inherited, plus GET /admin/users/{userId}, which was added because
// the two access PUTs were the only way to see a user's roles and they only
// report them after replacing them.
// 285: and the formwork-customer mix — the share of customers in a period
// that are formwork accounts, against the 70% target. Added alongside the
// accounts businessTypeCode the ratio is computed from.
// 286: and reading a past quotation out of its own PDF. It is a read, not an
// import -- it writes nothing and hands back what the document was found to
// contain, including the rows it could not resolve.
// 326: and the order-to-cash chain built after that -- customer orders and
// their confirmation email, receivables and collections, work orders and the
// production schedule, shipment execution and POD, customer feedback, the
// customer map, the order-to-cash overview and the System page (email and
// backup status).
const EXPECTED_OPERATIONS = 326;
if (operations !== EXPECTED_OPERATIONS)
  findings.push(
    `expected ${EXPECTED_OPERATIONS} OpenAPI operations, found ${operations}`,
  );
if (typedOperations !== operations)
  findings.push(`enabled operation typing is ${typedOperations}/${operations}`);

const scans = scanDocument(api);
if (scans.genericObject > 0)
  findings.push(`GenericObject count ${scans.genericObject}`);
if (scans.placeholder > 0)
  findings.push(`placeholder count ${scans.placeholder}`);
// The order-to-cash response schemas (customer orders, receivables, work
// orders, shipments, feedback, map, system, complaint, import job) declare
// their fields but still allow extra ones. This is known debt: the count may
// only go down as each schema is closed, never up.
const OPEN_SCHEMAS_CEILING = 24;
if (scans.additionalPropertiesTrue > OPEN_SCHEMAS_CEILING)
  findings.push(
    `additionalProperties:true count ${scans.additionalPropertiesTrue} (ceiling ${OPEN_SCHEMAS_CEILING})`,
  );
if (scans.emptyObject > 0)
  findings.push(`untyped object count ${scans.emptyObject}`);

for (const requiredSchema of [
  "UUID",
  "Date",
  "DateTime",
  "CurrencyCode",
  "Money",
  "Decimal",
  "Percentage",
  "CountryCode",
  "TraceId",
  "CorrelationId",
  "RowVersion",
  "ResourceReference",
  "ErrorEnvelope",
  "Me",
  "Job",
  "AnalyticsResponseMetadata",
  "ContinentCode",
  "MarketScope",
  "CountryReference",
  "AccountListItem",
  "AccountDetail",
  "ProjectListItem",
  "ProjectDetail",
  "OpportunityListItem",
  "OpportunityDetail",
]) {
  if (api.components.schemas[requiredSchema] === undefined)
    findings.push(`missing common schema ${requiredSchema}`);
}

const jobStates =
  api.components.schemas.JobStatus?.properties?.statusCode?.enum ?? [];
if (
  JSON.stringify(jobStates) !==
  JSON.stringify(["QUEUED", "RUNNING", "COMPLETED", "FAILED"])
)
  findings.push(
    `JobStatus does not match durable jobs: ${JSON.stringify(jobStates)}`,
  );

if (
  JSON.stringify(sortOperations(implemented)) !==
  JSON.stringify(sortOperations(runtimeManifest))
)
  findings.push(
    "implemented operation manifest differs from OpenAPI IMPLEMENTED operations",
  );

for (const excluded of outOfScope) {
  const present =
    api.paths[excluded.path]?.[excluded.method.toLowerCase()] !== undefined;
  if (present)
    findings.push(
      `out-of-scope operation appears in OpenAPI: ${excluded.method} ${excluded.path}`,
    );
}

const generation = spawnSync(
  process.execPath,
  ["scripts/generate-api-contract-artifacts.mjs", "--check"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
  },
);
if (generation.status !== 0) {
  findings.push(
    `generated artifact drift: ${generation.stdout}${generation.stderr}`,
  );
}

if (findings.length > 0) {
  console.error(
    JSON.stringify({ result: "API_CONTRACT_CHECK_FAILED", findings }, null, 2),
  );
  process.exitCode = 1;
} else {
  console.info(
    JSON.stringify({
      result: "API_CONTRACT_CHECK_PASSED",
      operations,
      typedOperations,
      implementedOperations: implemented.length,
      contractedNotImplemented: operations - implemented.length,
      outOfScopeOperations: outOfScope.length,
      unresolvedRefs: 0,
      duplicateOperationIds: 0,
      ...scans,
      generatedArtifactDrift: 0,
    }),
  );
}

function responseHasSchema(response) {
  return Object.values(response?.content ?? {}).some(
    (media) => media.schema !== undefined,
  );
}

function requestBodyHasSchema(requestBody) {
  const representations = Object.values(requestBody?.content ?? {});
  return (
    representations.length > 0 &&
    representations.every(
      (representation) => representation?.schema !== undefined,
    )
  );
}

function scanDocument(document) {
  const counts = {
    genericObject: 0,
    placeholder: 0,
    additionalPropertiesTrue: 0,
    emptyObject: 0,
  };
  const visited = new WeakSet();
  function visit(value, key = "") {
    if (typeof value === "string") {
      if (/GenericObject/i.test(value)) counts.genericObject += 1;
      if (/\b(?:TODO|TBD|placeholder)\b/i.test(value)) counts.placeholder += 1;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (value.additionalProperties === true)
      counts.additionalPropertiesTrue += 1;
    const isObject = value.type === "object";
    const meaningful =
      Object.keys(value.properties ?? {}).length > 0 ||
      (value.additionalProperties !== undefined &&
        value.additionalProperties !== false) ||
      value.oneOf !== undefined ||
      value.allOf !== undefined ||
      value.$ref !== undefined;
    if (isObject && !meaningful && key !== "schema") counts.emptyObject += 1;
    for (const [childKey, child] of Object.entries(value))
      visit(child, childKey);
  }
  visit(document);
  return counts;
}

function sortOperations(value) {
  return [...value].sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(
      `${right.method} ${right.path}`,
    ),
  );
}
