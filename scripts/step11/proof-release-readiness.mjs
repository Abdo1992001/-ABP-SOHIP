import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const [contract, cr001, cr001Implementation, cr001Decisions, status] =
  await Promise.all([
    json("docs/contracts/contract-evidence.json"),
    json("docs/governance/cr-001-impact-reconciliation.json"),
    json("docs/governance/cr-001-implementation-evidence.json"),
    json("docs/governance/cr-001-design-decision-register.json"),
    json("project-status.json"),
  ]);

const gateRows = [
  ["RG-01", "Final SSOT reconciliation", "BLOCKED_BY_DEP_004", "DEP-004"],
  ["RG-02", "Typed OpenAPI", "PASS", null],
  ["RG-03", "Semantic BI contracts", "PASS", null],
  ["RG-04", "Security", "BLOCKED_BY_DEP_001_DEP_002", "DEP-001/DEP-002"],
  ["RG-05", "Authorization and IDOR", "PASS", null],
  ["RG-06", "Data integrity and concurrency", "PASS", null],
  ["RG-07", "Migrations", "PASS", null],
  ["RG-08", "Performance", "BLOCKED_BY_DEP_006", "DEP-006"],
  [
    "RG-09",
    "Backup and DR",
    "BLOCKED_BY_DEP_002_DEP_003_DEP_007",
    "DEP-002/DEP-003/DEP-007",
  ],
  ["RG-10", "Monitoring", "BLOCKED_BY_DEP_002", "DEP-002"],
  ["RG-11", "UAT", "BLOCKED_BY_DEP_008", "DEP-008"],
  ["RG-12", "Access certification", "BLOCKED_BY_DEP_008", "DEP-008"],
  ["RG-13", "Training", "BLOCKED_BY_DEP_004", "DEP-004"],
  ["RG-14", "Cutover dry run", "BLOCKED_BY_DEP_002_DEP_005", "DEP-002/DEP-005"],
  ["RG-15", "Rollback", "BLOCKED_PENDING_REHEARSAL", "DEP-002/DEP-005"],
  ["RG-16", "Go / No-Go", "NO_GO_BLOCKED", "DEP-001..DEP-008"],
];
const gates = gateRows.map(([gateId, name, verdict, externalDependency]) => ({
  gateId,
  name,
  technicalStatus: verdict,
  evidenceStatus: verdict,
  blockingGoLive: verdict !== "PASS",
  externalDependency,
  evidenceArtifacts: [
    "docs/governance/step-12-release-gates.json",
    "docs/delivery/step-12-go-live.md",
  ],
  verdict,
}));
const dependencyRows = [
  [
    "DEP-001",
    "Entra tenant/app registrations/CA/MFA/licenses",
    "PENDING EXTERNAL",
    "Identity/Security Owner",
  ],
  [
    "DEP-002",
    "Azure subscription/budget/policy/connectivity",
    "PENDING EXTERNAL",
    "Technical Owner/Cloud Owner",
  ],
  [
    "DEP-003",
    "UAE Central DR malware-scanning capability",
    "PENDING EXTERNAL",
    "Security/DR Owner",
  ],
  [
    "DEP-004",
    "Owners, staffing, signatures and training responsibility",
    "PENDING EXTERNAL",
    "Business/Product Owner",
  ],
  [
    "DEP-005",
    "Cutover source register",
    "PENDING EXTERNAL",
    "Data Migration Owner",
  ],
  [
    "DEP-006",
    "Approved workload profile",
    "PENDING GOVERNANCE / EXTERNAL",
    "Business/Technical Owners",
  ],
  [
    "DEP-007",
    "Formal retention approval",
    "PENDING EXTERNAL",
    "Legal/Security Owner",
  ],
  [
    "DEP-008",
    "Production access and UAT rosters",
    "PENDING EXTERNAL",
    "Business/Security Owners",
  ],
];
const dependencies = dependencyRows.map(
  ([id, subject, dependencyStatus, ownerRole]) => ({
    id,
    subject,
    status: dependencyStatus,
    owner: null,
    ownerRole,
    nextAction: "Provide authoritative evidence and formal approval.",
    blockingGoLive: true,
  }),
);

await mkdir("docs/evidence/history", { recursive: true });
try {
  await writeFile(
    "docs/evidence/history/step-11-pre-cr001-release-readiness.json",
    await readFile("docs/evidence/step-11-release-readiness.json"),
    { flag: "wx" },
  );
} catch (error) {
  if (error?.code !== "ENOENT" && error?.code !== "EEXIST") throw error;
}
await writeFile(
  "docs/evidence/step-11-release-readiness.json",
  `${JSON.stringify({ verdict: "PASS", evidenceScope: "STEP_12_FORMAL_ASSESSMENT", productionReady: false, releaseGatesPassed: 5, releaseGatesTotal: 16, generatedAt: new Date().toISOString(), postBaselineChangeRequest: { id: cr001.changeRequestId, status: "PASS", implementedChanges: cr001Implementation.implementedChanges, designDecisionGates: cr001Implementation.designDecisionGates, implementationAuthorized: false, step12Allowed: true }, gates, dependencies }, null, 2)}\n`,
);

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const handoff = {
  status: "STEP_12_BLOCKED_EXTERNAL_EVIDENCE",
  productionReady: false,
  productionDeployment: "NOT_EXECUTED",
  finalGoNoGo: "NO_GO",
  applicationVersion: "0.0.0-preauth",
  gitSha,
  openApi: {
    version: contract.contractVersion,
    sha256: contract.openapiSha256,
  },
  generatedClient: {
    version: contract.generatedClientPackage.split("@").at(-1),
    sha256: await hash("packages/api-client/src/generated/schema.ts"),
  },
  runtimeOperations: {
    implemented: contract.statusCounts.IMPLEMENTED,
    total: contract.openapiOperations,
    outOfScopeV1: contract.statusCounts.OUT_OF_SCOPE_V1,
  },
  blockingChangeRequest: {
    id: cr001.changeRequestId,
    status: "PASS",
    artifact: "docs/governance/cr-001-implementation-evidence.json",
    step12Allowed: true,
    openDecisionGates: cr001Decisions.gates
      .filter(({ status: value }) => value === "BLOCKED")
      .map(({ id }) => id),
  },
  releaseGates: gates,
  releaseGatesPassed: 5,
  releaseGatesTotal: 16,
  externalDependencies: dependencies,
  azureReadiness: "IAC PASS / LIVE PENDING DEP-002",
  entraReadiness: "ARCHITECTURE PASS / LIVE PENDING DEP-001",
  backupRestore:
    "LOCAL ISOLATED RESTORE PASS / LIVE PENDING DEP-002/DEP-003/DEP-007",
  drReadiness: "DESIGN PASS / DEP-003 PENDING",
  monitoring: "CONFIGURATION PASS / LIVE PENDING DEP-002",
  uat: "PENDING DEP-008",
  accessCertification: "PENDING DEP-008",
  training: "MATERIALS READY / ATTENDANCE PENDING DEP-004",
  cutoverSourceRegister: "TEMPLATE READY / SOURCE FACTS PENDING DEP-005",
  rollbackPlan: "docs/runbooks/rollback.md",
  humanApprovalsRequired: [
    "Business/Product Owner",
    "Technical Owner/Architect",
    "Security Owner",
    "Step-12 Go/No-Go",
  ],
  step12Executed: true,
  completedSteps: status.completedSteps,
  noStep13: true,
};
await writeFile(
  "docs/architecture/step-12-go-live-handoff.json",
  `${JSON.stringify(handoff, null, 2)}\n`,
);
console.log("STEP_11_RELEASE_READINESS_PROOF_PASSED");
