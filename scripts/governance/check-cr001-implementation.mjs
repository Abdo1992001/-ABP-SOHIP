import { readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const text = (path) => readFile(path, "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const [evidence, decisions, status, contract, metrics, reports, inventory] =
  await Promise.all([
    json("docs/governance/cr-001-implementation-evidence.json"),
    json("docs/governance/cr-001-design-decision-register.json"),
    json("project-status.json"),
    json("docs/contracts/contract-evidence.json"),
    json("docs/analytics/metric-registry.json"),
    json("docs/analytics/report-registry.json"),
    json("docs/contracts/api-inventory.json"),
  ]);
const [schema, service, crService, externalGuard, screens, controller] =
  await Promise.all([
    text("packages/database/prisma/schema.prisma"),
    text("apps/api/src/analytics/analytics.service.ts"),
    text("apps/api/src/cr001/cr001.service.ts"),
    text("apps/api/src/cr001/external-client.guard.ts"),
    text("apps/web/src/app/screen-registry.ts"),
    text("apps/api/src/quotation/quotation.controller.ts"),
  ]);

assert(evidence.status === "PASS", "CR-001 must have executed PASS evidence.");
assert(
  evidence.designDecisionGates.closed === 10 &&
    evidence.designDecisionGates.blocked === 0 &&
    evidence.implementedChanges.implemented === 10,
  "CR-001 gate/change closure drifted.",
);
assert(
  decisions.summary.closed === 10 &&
    decisions.summary.blocked === 0 &&
    decisions.gates.every(({ status: gateStatus }) =>
      ["CLOSED", "CLOSED_BUSINESS_APPROVED"].includes(gateStatus),
    ),
  "CR-001 decision register is not fully closed.",
);
// The contract has grown since CR-001 closed, so its final OpenAPI and client
// hashes are historical evidence, not the current contract. What must hold is
// that the current contract still carries every CR-001 operation, all of them
// implemented; api:contract:check proves the hashes match the current files.
assert(
  contract.contractVersion === "1.6.0" &&
    contract.openapiOperations >= 217 &&
    contract.statusCounts?.IMPLEMENTED === contract.openapiOperations &&
    /^[0-9a-f]{64}$/.test(evidence.contract.finalOpenApiSha256) &&
    /^[0-9a-f]{64}$/.test(evidence.contract.finalGeneratedClientSha256),
  "CR-001 final typed contract evidence drifted.",
);
assert(
  evidence.contract.originalBaselineOpenApiSha256 ===
    "7a7cb32a0df396e7bd4241ccfda4bbaf4f9eb891e2b35f17f43286f7515cbbba" &&
    evidence.contract.historicalEvidenceOverwritten === false,
  "Historical contract lineage was not preserved.",
);
assert(
  metrics.metrics.length === 72 &&
    metrics.metrics.some(
      ({ metricId, name }) =>
        metricId === "MET-CUST-006" &&
        name === "Booked Value by Customer Segment",
    ) &&
    reports.reports.some(
      ({ reportId, metricIds }) =>
        reportId === "RPT-007" && metricIds.includes("MET-CUST-006"),
    ),
  "Effective-dated Customer Segment analytics are missing.",
);
for (const required of [
  "model CustomerSegmentDefinition",
  "model CustomerSegmentAssignment",
  "model QuotationCommercialStateEvent",
  "model Shipment",
  "model ShipmentMilestoneEvent",
  "model ExternalClientIdentity",
  "model ClientCustomerBinding",
  "model GeographyClassificationRule",
])
  assert(schema.includes(required), `Missing CR-001 model: ${required}`);
for (const required of [
  "assignment.effective_from <= e.imported_at",
  "e.dq_status_code = 'VALID'",
  "MET-CUST-006",
  "UNCLASSIFIED",
])
  assert(service.includes(required), `Missing segment guard: ${required}`);
for (const required of [
  "READY_FOR_DELIVERY",
  "VESSEL_DEPARTED",
  "ARRIVED_AT_PORT_OF_DISCHARGE",
  "UNDER_NEGOTIATION",
  "researchSizes",
  "portalOrders",
  "portalShipments",
  "portalComplaints",
])
  assert(crService.includes(required), `Missing CR-001 runtime: ${required}`);
assert(
  externalGuard.includes("ABP_EXTERNAL_ASSERTION_SECRET") &&
    externalGuard.includes("timingSafeEqual"),
  "External portal BFF assertion boundary is missing.",
);
for (const screenId of [
  'id: "COMPLAINTS"',
  'id: "COMPLAINT_DETAIL"',
  'id: "SHIPMENTS"',
  'id: "SHIPMENT_DETAIL"',
  'id: "RESEARCH"',
  'id: "ADMIN_SEGMENTS"',
  'id: "ADMIN_CLIENT_IDENTITIES"',
])
  assert(screens.includes(screenId), `Missing CR-001 screen: ${screenId}`);
// Quotation Cancel was out of V1 when CR-001 closed; it has since shipped
// (feat: implement quotation supersession and cancellation). The route and
// the contract must agree on that.
assert(
  controller.includes('@Post(":quotationId/cancel")') &&
    inventory.some(
      ({ operationId, implementationStatus }) =>
        operationId === "post_quotations_by_quotationId_cancel" &&
        implementationStatus === "IMPLEMENTED",
    ),
  "Quotation Cancel route and contract disagree.",
);
assert(
  evidence.negativeTests.executed >= 40 &&
    evidence.negativeTests.result === "PASS" &&
    evidence.preserved.ssotDeviations === 0,
  "CR-001 negative-test or SSOT evidence is incomplete.",
);
assert(
  status.step12 === "BLOCKED_EXTERNAL_AND_RELEASE_EVIDENCE" &&
    status.implementationAuthorized === false &&
    status.productionReady === false &&
    status.releaseGatesPassed === 5 &&
    status.releaseGatesTotal === 16,
  "CR-001 changed forbidden global release state.",
);

console.log("CR_001_IMPLEMENTATION_PROOF_PASS");
