import fs from "node:fs";
const handoff = JSON.parse(
  fs.readFileSync("docs/architecture/step-08-workflow-handoff.json", "utf8"),
);
const required = [
  "operationId",
  "domain",
  "command",
  "aggregate",
  "allowedSourceStates",
  "requestedState",
  "transactionBoundary",
  "outboxEvent",
  "jobType",
  "idempotency",
  "locking",
  "failureStates",
  "retryExpectation",
  "externalDependency",
  "step8Responsibility",
];
if (
  handoff.unmapped !== 0 ||
  handoff.mapped !== handoff.workflowDependentOperations.length
)
  throw new Error("WORKFLOW_HANDOFF_COUNT_MISMATCH");
const ids = new Set();
for (const row of handoff.workflowDependentOperations) {
  for (const key of required)
    if (!(key in row))
      throw new Error(
        `WORKFLOW_HANDOFF_FIELD_MISSING:${row.operationId}:${key}`,
      );
  if (ids.has(row.operationId))
    throw new Error(`WORKFLOW_HANDOFF_DUPLICATE:${row.operationId}`);
  ids.add(row.operationId);
}
const inventory = JSON.parse(
  fs.readFileSync("docs/contracts/api-inventory.json", "utf8"),
);
for (const id of ids) {
  const op = inventory.find((x) => x.operationId === id);
  if (!op || op.implementationStatus !== "IMPLEMENTED")
    throw new Error(`WORKFLOW_OPERATION_NOT_RUNTIME_READY:${id}`);
}
console.log(
  JSON.stringify({
    result: "STEP8_HANDOFF_PASS",
    mapped: ids.size,
    unmapped: 0,
  }),
);
