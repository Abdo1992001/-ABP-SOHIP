import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFile(resolve(root, path), "utf8");
const failures = [];
const expect = (condition, code) => {
  if (!condition) failures.push(code);
};
const block = (source, model) => {
  const start = source.indexOf(`model ${model} {`);
  return start < 0
    ? ""
    : source.slice(start, source.indexOf("\n}\n", start) + 3);
};

const [routes, schema, excluded, capacity, logistics, mapText] =
  await Promise.all([
    read("apps/web/src/app/routes.ts"),
    read("packages/database/prisma/schema.prisma"),
    read("docs/contracts/out-of-scope-v1.yaml"),
    read("docs/contracts/openapi/components/schemas/CapacityRate.yaml"),
    read("docs/contracts/openapi/components/schemas/LogisticsPlanVersion.yaml"),
    read("docs/architecture/business-domain-map.json"),
  ]);
const domainMap = JSON.parse(mapText);
const excludedPaths = new Set(
  YAML.parse(excluded).operations.map((item) => item.path),
);

expect(
  routes.includes('path: "/sales/management"') &&
    routes.includes('workspace: "sales"'),
  "SALES_MANAGEMENT_MUST_BE_UNDER_SALES",
);
expect(
  routes.includes('path: "/sales/support"') &&
    routes.includes('kind: "support"'),
  "SALES_SUPPORT_MUST_BE_UNDER_SALES",
);
expect(
  !routes.includes('path: "/management"') &&
    !routes.includes('path: "/support"'),
  "NO_TOP_LEVEL_MANAGEMENT_OR_SUPPORT_WORKSPACE",
);

const account = block(schema, "Account");
const contact = block(schema, "Contact");
const project = block(schema, "Project");
const opportunity = block(schema, "Opportunity");
const product = block(schema, "Product");
const pricing = block(schema, "PricingRule");
const quotation = block(schema, "Quotation");
const quotationLine = block(schema, "QuotationLine");
expect(
  account.includes("hqCountryCode") &&
    project.includes("countryCode") &&
    !project.includes("hqCountryCode"),
  "PROJECT_COUNTRY_MUST_NOT_BE_CUSTOMER_HQ_COUNTRY",
);
expect(
  contact.includes("accountId") && !contact.includes("userId"),
  "CONTACT_MUST_BELONG_TO_CUSTOMER_NOT_APP_USER",
);
expect(
  opportunity.includes("stageCode") &&
    project.includes("stageCode") &&
    quotation.includes("statusCode"),
  "COMMERCIAL_STATUSES_MUST_REMAIN_SEPARATE",
);
expect(
  product.includes("pricingRules") &&
    pricing.includes("effectiveFrom") &&
    pricing.includes("minPrice") &&
    pricing.includes("referencePrice") &&
    pricing.includes("maxPrice"),
  "PRODUCT_AND_EFFECTIVE_DATED_PRICING_MUST_REMAIN_SEPARATE",
);
expect(
  quotation.includes("supersedesQuotationId") &&
    !schema.includes("model QuotationRevision") &&
    !schema.includes("model QuotationFamily"),
  "QUOTATION_MUST_USE_SUPERSESSION_NOT_FORMAL_REVISIONS",
);
expect(
  quotationLine.includes("priceRuleId") &&
    quotationLine.includes("priceSnapshot"),
  "QUOTATION_LINE_MUST_REFERENCE_PRICING_SNAPSHOT_SOURCE",
);

// Work orders and shipment proof of delivery were brought into scope (they
// are implemented); the paths below stay out of V1.
for (const path of [
  "/sales-orders",
  "/sales-orders/{salesOrderId}/confirm",
  "/sales-orders/{salesOrderId}/amend",
  "/sales-orders/{salesOrderId}/handover",
  "/sales-orders/{salesOrderId}/close",
  "/capacity/reservations",
  "/mes/routings",
  "/quality-control/inspections",
  "/quotation-families",
  "/quotations/{quotationId}/revisions",
])
  expect(excludedPaths.has(path), `V1_FORBIDDEN_PATH_MISSING:${path}`);

expect(
  /900/.test(capacity) &&
    /700/.test(capacity) &&
    /600/.test(capacity) &&
    /Estimate-only rates at 24 hours\/day/.test(capacity),
  "CAPACITY_MUST_REMAIN_900_700_600_ESTIMATE_ONLY",
);
expect(
  /Flat-on-Face/.test(logistics) &&
    /0\/90/.test(logistics) &&
    /No dispatch, delivery, or POD execution/.test(logistics),
  "LOGISTICS_MUST_REMAIN_FLAT_ON_FACE_PLANNING_ONLY",
);

const allowedStatuses = new Set([
  "IMPLEMENTED",
  "PARTIALLY_IMPLEMENTED",
  "CONTRACTED",
  "OUT_OF_CURRENT_STEP_2_IMPLEMENTATION",
]);
expect(
  domainMap.workspaceModel?.core === "sales",
  "DOMAIN_MAP_SALES_MUST_BE_CORE",
);
expect(
  Array.isArray(domainMap.domains) && domainMap.domains.length >= 20,
  "DOMAIN_MAP_MUST_COVER_MAJOR_DOMAINS",
);
for (const domain of domainMap.domains ?? []) {
  expect(
    allowedStatuses.has(domain.status),
    `DOMAIN_STATUS_INVALID:${domain.name}`,
  );
  expect(
    Array.isArray(domain.forbiddenDependencies) &&
      domain.forbiddenDependencies.length > 0,
    `DOMAIN_FORBIDDEN_BOUNDARY_MISSING:${domain.name}`,
  );
}

if (failures.length) {
  console.error(JSON.stringify({ result: "FAIL", failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: 16,
      domains: domainMap.domains.length,
      ssotDeviations: 0,
    }),
  );
}
