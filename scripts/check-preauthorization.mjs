import { readFileSync } from "node:fs";

const status = JSON.parse(
  readFileSync(new URL("../project-status.json", import.meta.url), "utf8"),
);
if (status.implementationAuthorized !== false)
  throw new Error("Implementation authorization cannot be claimed yet.");
if (status.productionReady !== false)
  throw new Error("Production readiness cannot be claimed yet.");
if (status.rg01 !== "EVIDENCE_GENERATED_AWAITING_SIGNOFF")
  throw new Error("RG-01 state is not allowed during technical preparation.");
if (status.releaseGatesPassed !== 5 || status.releaseGatesTotal !== 16)
  throw new Error("Release-gate count drifted.");
if (
  status.phase !== "STEP_12_BLOCKED_EXTERNAL_EVIDENCE" ||
  JSON.stringify(status.completedSteps) !==
    JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) ||
  !Array.isArray(status.step11TechnicalBlockers) ||
  status.step11TechnicalBlockers.length !== 0
)
  throw new Error("The Steps 1-11 reconciliation baseline drifted.");
if (status.step12 !== "BLOCKED_EXTERNAL_AND_RELEASE_EVIDENCE")
  throw new Error("Step 12 evidence boundary drifted.");
if (
  status.changeRequests?.["CR-001"]?.status !== "PASS" ||
  status.changeRequests?.["CR-001"]?.implementationAuthorized !== false ||
  status.changeRequests?.["CR-001"]?.step12Blocked !== false ||
  status.changeRequests?.["CR-001"]?.designDecisionGates?.closed !== 10 ||
  status.changeRequests?.["CR-001"]?.designDecisionGates?.blocked !== 0
)
  throw new Error("CR-001 governance state drifted.");

console.log("Pre-authorization status guard passed.");
