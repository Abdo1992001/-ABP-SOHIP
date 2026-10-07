import { access, readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requiredDocuments = [
  "docs/delivery/step-12-baseline-freeze.md",
  "docs/delivery/step-12-go-live.md",
  "docs/governance/step-12-baseline-freeze.json",
  "docs/governance/step-12-release-gates.json",
  "docs/governance/go-live-checklist.json",
  "docs/governance/final-go-no-go.md",
  "docs/governance/final-go-no-go.json",
  "docs/governance/production-access-certification.md",
  "docs/governance/uat-plan.md",
  "docs/governance/training-readiness.md",
  "docs/governance/cutover-source-register.md",
  "docs/runbooks/go-live-cutover.md",
  "docs/runbooks/rollback.md",
  "docs/runbooks/production-validation.md",
  "docs/runbooks/hypercare.md",
];
await Promise.all(requiredDocuments.map((path) => access(path)));

const [status, gates, checklist, decision, freeze, handoff] = await Promise.all(
  [
    json("project-status.json"),
    json("docs/governance/step-12-release-gates.json"),
    json("docs/governance/go-live-checklist.json"),
    json("docs/governance/final-go-no-go.json"),
    json("docs/governance/step-12-baseline-freeze.json"),
    json("docs/architecture/step-12-go-live-handoff.json"),
  ],
);
assert(gates.gates.length === 16, "STEP12_GATE_COUNT_DRIFT");
assert(
  gates.gates.filter(({ status: value }) => value === "PASS").length === 5 &&
    gates.passed === 5,
  "STEP12_GATE_PASS_COUNT_DRIFT",
);
assert(
  ["RG-02", "RG-03", "RG-05", "RG-06", "RG-07"].every(
    (id) => gates.gates.find((gate) => gate.id === id)?.status === "PASS",
  ),
  "STEP12_TECHNICAL_GATE_DRIFT",
);
assert(
  checklist.dependencies.length === 8 &&
    checklist.dependencies.every(({ status: value }) =>
      value.startsWith("PENDING"),
    ),
  "STEP12_DEPENDENCY_EVIDENCE_WAS_FABRICATED",
);
assert(
  decision.decision === "NO_GO" &&
    decision.productionReady === false &&
    decision.productionDeployment === "NOT_EXECUTED" &&
    decision.actualApprovals.length === 0,
  "STEP12_GO_NO_GO_BOUNDARY_DRIFT",
);
assert(
  freeze.git.dirty === true &&
    freeze.git.releaseCandidateImmutable === false &&
    freeze.sourceLineage.dockerImageSourceCommit ===
      "UNFREEZABLE_DIRTY_WORKTREE",
  "STEP12_BASELINE_FREEZE_WAS_FABRICATED",
);
assert(
  status.step12 === "BLOCKED_EXTERNAL_AND_RELEASE_EVIDENCE" &&
    status.productionReady === false &&
    status.releaseGatesPassed === 5 &&
    status.releaseGatesTotal === 16,
  "STEP12_PROJECT_STATUS_DRIFT",
);
assert(
  handoff.status === "STEP_12_BLOCKED_EXTERNAL_EVIDENCE" &&
    handoff.step12Executed === true &&
    handoff.productionDeployment === "NOT_EXECUTED" &&
    handoff.noStep13 === true,
  "STEP12_HANDOFF_DRIFT",
);
console.log(
  JSON.stringify({
    result: "STEP_12_GO_LIVE_PROOF_PASS",
    step12: "BLOCKED_EXTERNAL_EVIDENCE",
    productionReady: false,
    productionDeployment: "NOT_EXECUTED",
    releaseGates: "5/16",
    dependenciesPending: 8,
    noStep13: true,
  }),
);
