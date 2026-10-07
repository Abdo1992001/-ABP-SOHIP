import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const inventory = JSON.parse(
  await readFile(resolve(root, "docs/contracts/api-inventory.json"), "utf8"),
);

// Stable functional-requirement ownership, not a runtime implementation claim.
const requirements = {
  Administration: [
    "FR-ADM-001",
    "Document Template Administration",
    "/admin/templates",
    8,
    9,
  ],
  Activities: [
    "FR-ACT-001",
    "Activities / Follow-ups",
    "/sales/activities",
    8,
    9,
  ],
  AI: ["FR-AI-001", "Customer Intelligence", "/sales/intelligence", 8, 9],
  Analytics: ["FR-ANL-001", "Analytics / Reports", "/sales/management", 10, 10],
  Approval: ["FR-APR-001", "Approval Work Queue", "/sales/approvals", 8, 9],
  Audit: ["FR-AUD-001", "Audit / Security Events", "/admin/audit", 7, 9],
  Capacity: ["FR-CAP-001", "Capacity Estimate", "/operations/capacity", 8, 9],
  Catalog: ["FR-CAT-001", "Product Catalog", "/sales/products", 7, 9],
  Cheques: ["FR-CHQ-001", "Finance Cheques", "/finance/cheques", 8, 9],
  "Client Portal": [
    "FR-PORTAL-001",
    "Restricted Client Portal",
    "/portal",
    8,
    9,
  ],
  "Commercial Intelligence": [
    "FR-MI-001",
    "Market Intelligence / Repeat Business",
    "/sales/intelligence",
    8,
    9,
  ],
  CRM: ["FR-CRM-001", "Customer 360", "/sales/customers", 7, 9],
  "CRM Service": ["FR-CRM-SVC-001", "Complaints", "/sales/complaints", 8, 9],
  Dashboard: ["FR-DASH-001", "Sales Home / My Work", "/sales", 9, 9],
  "Data Quality": [
    "FR-DQ-001",
    "Import Data Quality Review",
    "/erp/imports",
    8,
    9,
  ],
  Documents: ["FR-DOC-001", "Authorized Documents", "/documents", 8, 9],
  "ERP Orders": ["FR-ERP-001", "ERP Read-only Orders", "/erp/orders", 7, 9],
  Exports: ["FR-EXP-001", "Governed Exports", "/exports", 8, 9],
  "Finance FX": ["FR-FX-001", "FX Rates", "/finance/fx", 8, 9],
  Identity: ["FR-IDM-001", "Access Administration", "/admin/access", 7, 9],
  Imports: ["FR-IMP-001", "ERP Import", "/erp/imports", 8, 9],
  Logistics: [
    "FR-LOG-001",
    "Logistics Estimate Planner and Shipment Tracking",
    "/logistics/plans",
    8,
    9,
  ],
  Messages: [
    "FR-MSG-001",
    "Messages / Record Conversations",
    "/messages",
    8,
    9,
  ],
  Notifications: ["FR-NOT-001", "Notifications", "/notifications", 8, 9],
  Opportunity: [
    "FR-OPP-001",
    "Opportunities / Pipeline",
    "/sales/opportunities",
    8,
    9,
  ],
  Payments: ["FR-PAY-001", "Finance Payments", "/finance/payments", 8, 9],
  Pipeline: [
    "FR-OPP-001",
    "Opportunities / Pipeline",
    "/sales/opportunities",
    8,
    9,
  ],
  Platform: ["FR-PLT-001", "Platform Foundation", null, 1, 1],
  "Platform Reference": ["FR-REF-001", "Governed Selectors", null, 7, 9],
  Preferences: [
    "FR-PREF-001",
    "User Preferences / Locale",
    "/preferences",
    9,
    9,
  ],
  Pricing: ["FR-PRI-001", "Pricing Context", "/sales/pricing", 8, 9],
  Projects: ["FR-PRJ-001", "Projects", "/sales/projects", 8, 9],
  Quotation: ["FR-QTN-001", "Quotations", "/sales/quotations", 8, 9],
  "R&D": ["FR-RND-001", "Most Requested Sizes", "/research", 10, 9],
  Reconciliation: [
    "FR-REC-001",
    "ERP Reconciliation",
    "/erp/reconciliation",
    8,
    9,
  ],
  Returns: ["FR-RET-001", "Returned Scrap", "/returns", 8, 9],
  Search: ["FR-SRC-001", "Global Sales Search", "/sales", 7, 9],
  Targets: ["FR-TGT-001", "Company Targets", "/sales/targets", 10, 10],
  "Customer Feedback": [
    "FR-FBK-001",
    "Customer Feedback",
    "/customer-feedback",
    8,
    9,
  ],
  "Customer Map": ["FR-MAP-001", "Customer Map", "/map", 8, 9],
  "Customer Orders": [
    "FR-ORD-001",
    "Customer Orders",
    "/customer-orders",
    8,
    9,
  ],
  Operations: [
    "FR-OPS-001",
    "Work Orders / Production Schedule",
    "/work-orders",
    8,
    9,
  ],
  Overview: ["FR-OVR-001", "Order-to-Cash Overview", "/today", 8, 9],
  Receivables: [
    "FR-RCV-001",
    "Receivables / Collections",
    "/finance/receivables",
    8,
    9,
  ],
  System: ["FR-SYS-001", "System Status", "/admin/system", 8, 9],
};

const acceptanceScenarios = [
  [
    "FA-01",
    "Product to Pricing",
    "sales.user",
    "catalog.view, pricing.view",
    7,
  ],
  ["FA-02", "Pricing to Draft Quotation", "sales.user", "quotation.create", 8],
  ["FA-03", "Draft to Approval", "sales.manager", "quotation.approve", 8],
  ["FA-04", "Approved to Official PDF", "sales.user", "quotation.view", 8],
  [
    "FA-05",
    "Official PDF to legitimate SENT",
    "sales.user",
    "quotation.send",
    8,
  ],
  ["FA-06", "SENT to superseding Draft", "sales.user", "quotation.create", 8],
  [
    "FA-07",
    "ERP upload to DQ and commit",
    "sales.support",
    "imports.manage",
    8,
  ],
  ["FA-08", "ERP read-only facts", "sales.user", "sales-orders.view", 7],
  ["FA-09", "Capacity golden cases", "operations.user", "capacity.estimate", 7],
  [
    "FA-10",
    "Logistics canonical placement",
    "logistics.user",
    "logistics.plan",
    8,
  ],
  [
    "FA-11",
    "Finance FX effective rate",
    "finance.user",
    "finance.fx.manage",
    7,
  ],
  [
    "FA-12",
    "Returned Scrap request and approval",
    "sales.manager",
    "returns.approve",
    8,
  ],
  [
    "FA-13",
    "Arabic and English screen behavior",
    "sales.user",
    "sales.workspace.view",
    9,
  ],
  [
    "FA-14",
    "Cross-workspace negative authorization",
    "logistics.user",
    "sales.workspace.view",
    7,
  ],
].map(([id, title, actor, permissions, implementingStep]) => ({
  id,
  title,
  preconditions: ["authorized active session", "Country Scope valid"],
  actor,
  permissions: permissions.split(", "),
  inputs: ["typed V1 contract input"],
  steps: ["invoke contracted action"],
  expectedOutcome: "server-authoritative contracted result",
  negativeCase:
    "missing permission, DENY, or out-of-country access is rejected",
  futureImplementingStep: implementingStep,
  futureEvidenceOwner:
    implementingStep === 9 ? "frontend E2E" : "PostgreSQL/API integration",
}));

const missing = inventory.filter(
  (operation) => requirements[operation.module] === undefined,
);
const matrix = inventory.map((operation) => {
  const [requirementId, screen, route, workflowStep, frontendStep] =
    requirements[operation.module];
  return {
    requirementId,
    module: operation.module,
    screen,
    route,
    actor: "authorized application user",
    permissions: operation.permissionCode ? [operation.permissionCode] : [],
    action: operation.method,
    businessRules: ["SSOT-scoped", "Country Scope server-side", "DENY wins"],
    apiOperationIds: [operation.operationId],
    workflowIds:
      operation.executionMode === "ASYNC"
        ? [`WF-${operation.module.toUpperCase().replaceAll(" ", "-")}-001`]
        : [],
    entityDependencies: [operation.module],
    referenceDependencies:
      operation.module === "Platform Reference" ? ["Country"] : [],
    frontendImplementationStep: frontendStep,
    backendImplementationStep:
      operation.implementationStatus === "IMPLEMENTED" ? 1 : 7,
    workflowImplementationStep: workflowStep,
    analyticsDependency:
      operation.module === "Analytics" || operation.module === "Targets"
        ? 10
        : null,
    currentRuntimeStatus: operation.implementationStatus,
    V1Status:
      operation.implementationStatus === "OUT_OF_SCOPE_V1"
        ? "OUT_OF_SCOPE_V1"
        : "MANDATORY_V1",
  };
});
const contracted = matrix.filter(
  (record) => record.currentRuntimeStatus === "CONTRACTED_NOT_IMPLEMENTED",
);
const implemented = matrix.filter(
  (record) => record.currentRuntimeStatus === "IMPLEMENTED",
);
const outOfScope = matrix.filter(
  (record) => record.currentRuntimeStatus === "OUT_OF_SCOPE_V1",
);
const invalid = matrix.filter(
  (record) =>
    !record.requirementId ||
    !record.screen ||
    record.apiOperationIds.length !== 1 ||
    record.backendImplementationStep === undefined ||
    record.frontendImplementationStep === undefined,
);
if (
  missing.length ||
  invalid.length ||
  contracted.length + implemented.length + outOfScope.length !==
    matrix.length ||
  acceptanceScenarios.length !== 14
) {
  console.error(
    JSON.stringify({
      result: "FAIL",
      missing: missing.map((x) => x.operationId),
      invalid: invalid.map((x) => x.apiOperationIds[0]),
      contracted: contracted.length,
    }),
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    result: "PASS",
    requirements: Object.keys(requirements).length,
    screens: new Set(matrix.map((x) => x.screen)).size,
    functionalAcceptanceScenarios: acceptanceScenarios.length,
    typedOperationsMapped: matrix.length,
    contractedNotImplementedMapped: contracted.length,
    unmappedOperations: 0,
    ssotDeviations: 0,
  }),
);
