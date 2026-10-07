#!/usr/bin/env node
/**
 * Every column a record screen draws must exist in the contract.
 *
 * A column bound to a key the API never returns renders as an em dash. On an
 * empty table it is invisible; on a full one it looks like data the business
 * has not entered yet, rather than a wiring mistake — so it survives review,
 * survives tests that only assert the table rendered, and is discovered by a
 * user asking why a column is always blank.
 *
 * That is not hypothetical: the reconciliation screen carried four such
 * columns (`comparedCount`, `mismatchCount`, `matchedCount`, `missingCount`)
 * against a summary that has never contained any of them, and the capacity
 * estimate screen had a full set. Both passed every other check in this repo.
 *
 * The check resolves each screen's `listOperationId` back to its 200 response,
 * takes the schema of one row, and looks up every `field:` path the screen
 * declares. A path through a schema with `additionalProperties` and no
 * declared properties is reported too: an untyped bag cannot confirm anything,
 * and that is precisely where the reconciliation columns hid.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const api = await SwaggerParser.dereference(
  path.join(repositoryRoot, "docs/contracts/openapi/openapi.yaml"),
);

const byOperationId = new Map();
for (const [template, methods] of Object.entries(api.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (
      operation !== null &&
      typeof operation === "object" &&
      typeof operation.operationId === "string"
    ) {
      byOperationId.set(operation.operationId, { template, method, operation });
    }
  }
}

/** The schema describing one row of a list response. */
function rowSchema(operationId) {
  const entry = byOperationId.get(operationId);
  if (entry === undefined) return null;
  const ok =
    entry.operation.responses?.["200"] ?? entry.operation.responses?.["201"];
  const schema = ok?.content?.["application/json"]?.schema;
  const data = schema?.properties?.data;
  if (data === undefined) return null;
  return data.items ?? data;
}

/**
 * Every dotted path the schema admits. A property that is an untyped bag also
 * contributes `path.*`, which marks "anything below here is unverifiable".
 */
function paths(schema, prefix = "", depth = 0, seen = new Set()) {
  const out = new Set();
  if (schema === undefined || schema === null || depth > 4) return out;
  if (seen.has(schema)) return out;
  seen.add(schema);
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    for (const part of schema[key] ?? []) {
      for (const found of paths(part, prefix, depth, seen)) out.add(found);
    }
  }
  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    const key = prefix === "" ? name : `${prefix}.${name}`;
    out.add(key);
    if (
      sub !== null &&
      typeof sub === "object" &&
      sub.additionalProperties !== undefined &&
      sub.additionalProperties !== false &&
      sub.properties === undefined
    ) {
      out.add(`${key}.*`);
    }
    for (const found of paths(sub, key, depth + 1, seen)) out.add(found);
    if (sub?.items !== undefined) {
      for (const found of paths(sub.items, key, depth + 1, seen))
        out.add(found);
    }
  }
  return out;
}

const source = await fs.readFile(
  path.join(repositoryRoot, "apps/web/src/app/record-screens.ts"),
  "utf8",
);

const blocks = [...source.matchAll(/^ {2}([A-Z0-9_]+): \{$/gm)];
const problems = [];
for (let index = 0; index < blocks.length; index += 1) {
  const start = blocks[index].index;
  const end =
    index + 1 < blocks.length ? blocks[index + 1].index : source.length;
  const body = source.slice(start, end);
  const screenId = blocks[index][1];
  const operationId = /listOperationId:\s*"([^"]+)"/.exec(body)?.[1];
  if (operationId === undefined) continue;

  const schema = rowSchema(operationId);
  if (schema === null) {
    problems.push({ screenId, operationId, issue: "NO_RESPONSE_SCHEMA" });
    continue;
  }
  const known = paths(schema);
  for (const match of body.matchAll(/field:\s*"([^"]+)"/g)) {
    const field = match[1];
    // "items.0.categoryCode" reads the first element of an array; the schema
    // describes the element once, so indices are dropped before lookup.
    const lookup = field
      .split(".")
      .filter((part) => !/^\d+$/.test(part))
      .join(".");
    const root = lookup.split(".")[0];
    const untyped = known.has(`${root}.*`);
    if (!known.has(lookup) && !untyped) {
      problems.push({ screenId, operationId, field, issue: "NOT_IN_CONTRACT" });
    } else if (untyped && lookup.includes(".")) {
      problems.push({ screenId, operationId, field, issue: "UNTYPED_BAG" });
    }
  }
}

for (const problem of problems) {
  console.error(
    `${(problem.field ?? "-").padEnd(42)}${problem.screenId.padEnd(24)}${
      problem.issue
    }  [${problem.operationId}]`,
  );
}
console.log(
  JSON.stringify({
    result: problems.length === 0 ? "SCREEN_FIELDS_CHECK_PASSED" : "FAILED",
    screensChecked: blocks.length,
    problems: problems.length,
  }),
);
process.exit(problems.length === 0 ? 0 : 1);
