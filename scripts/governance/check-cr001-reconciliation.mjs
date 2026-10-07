import { readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const [reconciliation, evidence, decisions, status, handoff] =
  await Promise.all([
    json("docs/governance/cr-001-impact-reconciliation.json"),
    json("docs/governance/cr-001-implementation-evidence.json"),
    json("docs/governance/cr-001-design-decision-register.json"),
    json("project-status.json"),
    json("docs/architecture/step-12-go-live-handoff.json"),
  ]);

assert(
  reconciliation.changeRequestId === "CR-001" &&
    reconciliation.status === "IMPLEMENTED_RECONCILED",
  "CR-001 reconciliation status drifted.",
);
assert(
  reconciliation.approval.businessInputApproved === true &&
    reconciliation.approval.implementationAuthorized === true &&
    reconciliation.approval.productionAuthorized === false,
  "CR-001 approval boundary drifted.",
);
assert(
  reconciliation.governance.step12Allowed === true &&
    reconciliation.governance.historicalEvidenceMayBeOverwritten === false,
  "CR-001 forward-delta governance is unsafe.",
);
assert(
  reconciliation.scopeItems.length === 10 &&
    reconciliation.stepImpact.map(({ step }) => step).join(",") ===
      "2,3,4,5,6,7,8,9,10,11",
  "CR-001 scope/step impact drifted.",
);
const gates = reconciliation.decisionGateAudit ?? [];
assert(
  gates.length === 10 &&
    gates.map(({ id }) => id).join(",") ===
      Array.from(
        { length: 10 },
        (_, index) => `CR001-DG-${String(index + 1).padStart(2, "0")}`,
      ).join(",") &&
    reconciliation.finalReconciliation.openDecisionGates.length === 0 &&
    decisions.summary.closed === 10 &&
    decisions.summary.blocked === 0,
  "CR-001 decision-gate reconciliation is incomplete.",
);
assert(
  reconciliation.baselineBeforeChange.openApiEvidenceSha256 ===
    evidence.contract.originalBaselineOpenApiSha256 &&
    reconciliation.baselineBeforeChange.openApiCanonicalFileSha256 ===
      evidence.contract.originalBaselineOpenApiFileSha256 &&
    reconciliation.baselineBeforeChange.generatedClientSha256 ===
      evidence.contract.originalBaselineGeneratedClientSha256,
  "Immutable pre-CR contract lineage drifted.",
);
assert(
  evidence.status === "PASS" &&
    evidence.implementedChanges.implemented === 10 &&
    evidence.preserved.ssotDeviations === 0,
  "CR-001 implementation evidence is not closed.",
);
assert(
  status.phase === "STEP_12_BLOCKED_EXTERNAL_EVIDENCE" &&
    status.step12 === "BLOCKED_EXTERNAL_AND_RELEASE_EVIDENCE" &&
    status.changeRequests?.["CR-001"]?.status === "PASS" &&
    status.changeRequests?.["CR-001"]?.step12Blocked === false,
  "Project status does not expose the closed CR-001 boundary.",
);
assert(
  status.implementationAuthorized === false &&
    status.productionReady === false &&
    status.releaseGatesPassed === 5,
  "Global implementation/production/release status was falsely promoted.",
);
assert(
  handoff.status === "STEP_12_BLOCKED_EXTERNAL_EVIDENCE" &&
    handoff.step12Executed === true &&
    handoff.blockingChangeRequest?.status === "PASS" &&
    handoff.blockingChangeRequest?.step12Allowed === true &&
    handoff.productionReady === false,
  "Step-12 handoff boundary drifted.",
);

console.log("CR_001_RECONCILIATION_PASS");
