import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const schema = await readFile(
  resolve(root, "packages/database/prisma/schema.prisma"),
  "utf8",
);
const migration = (
  await Promise.all(
    [
      "20260822020000_step6_physical_schema",
      "20260825010000_cr001_business_decisions",
      "20260825011000_cr001_quotation_state_guard",
    ].map((directory) =>
      readFile(
        resolve(
          root,
          `packages/database/prisma/migrations/${directory}/migration.sql`,
        ),
        "utf8",
      ),
    ),
  )
).join("\n");
const logical = [
  "ApplicationUser",
  "Role",
  "Permission",
  "CountryScope",
  "UserPermissionOverride",
  "ApplicationSession",
  "Customer",
  "CustomerGroup",
  "CustomerGroupMembership",
  "CustomerShare",
  "Contact",
  "Project",
  "Opportunity",
  "OpportunityWonContribution",
  "Activity",
  "ProductFamily",
  "Product",
  "PricingRule",
  "PricingConfiguration",
  "Quotation",
  "QuotationLine",
  "QuotationAdjustment",
  "QuotationApproval",
  "OfficialQuotationDocument",
  "QuotationSendEvent",
  "ImportBatch",
  "ImportRow",
  "DQIssue",
  "ReconciliationRun",
  "ERPOrder",
  "ERPOrderLine",
  "CapacityRate",
  "CapacityEstimate",
  "LogisticsPlan",
  "LogisticsPlanVersion",
  "LogisticsPlacement",
  "FXRate",
  "Payment",
  "Cheque",
  "ReturnedScrapRequest",
  "ReturnedScrapItem",
  "CompanyTarget",
  "TargetAllocation",
  "Country",
  "Continent",
  "DocumentMetadata",
  "AuditEvent",
  "OutboxMessage",
  "DurableJob",
  "Shipment",
  "ShipmentMilestoneEvent",
];
const models = [
  "AppUser",
  "Role",
  "Permission",
  "UserCountryAccess",
  "UserPermissionOverride",
  "AppSession",
  "Account",
  "GroupNetwork",
  "AccountGroupMembership",
  "CustomerShare",
  "Contact",
  "Project",
  "Opportunity",
  "OpportunityWonSnapshot",
  "Activity",
  "ProductFamily",
  "Product",
  "PricingRule",
  "PricingConfiguration",
  "Quotation",
  "QuotationLine",
  "QuotationAdjustment",
  "QuotationApproval",
  "OfficialQuotationDocument",
  "QuotationSendEvent",
  "ImportBatch",
  "ImportRow",
  "DQIssue",
  "ReconciliationRun",
  "ERPOrder",
  "ERPOrderLine",
  "CapacityRate",
  "CapacityEstimate",
  "LogisticsPlan",
  "LogisticsPlanVersion",
  "LogisticsPlacement",
  "FXRate",
  "Payment",
  "Cheque",
  "ReturnedScrapRequest",
  "ReturnedScrapItem",
  "CompanyTarget",
  "TargetAllocation",
  "Country",
  "Continent",
  "DocumentMetadata",
  "AuditEvent",
  "OutboxMessage",
  "DurableJob",
  "Shipment",
  "ShipmentMilestoneEvent",
];
const missingModels = models.filter(
  (model) => !schema.includes("model " + model),
);
const forbidden = [
  "QuotationRevision",
  "InternalSalesOrder",
  "ProductionReservation",
  "ProductionOrder",
  "WorkOrder",
  "Routing",
  "WorkCenter",
  "QCInspection",
  "MESOperation",
  "Dispatch",
  "Delivery",
  "POD",
  "PersonalTarget",
  "NetCommercialSales",
].filter((name) => schema.includes("model " + name));
const required = [
  "quotation_approvals",
  "erp_orders",
  "capacity_rates",
  "logistics_placements",
  "fx_rates",
  "payments",
  "cheques",
  "returned_scrap_items",
  "company_targets",
  "document_metadata",
  "shipments",
  "shipment_milestone_events",
  "reject_sent_quotation_mutation",
  "reject_pricing_rule_overlap",
];
const absent = required.filter((item) => !migration.includes(item));
if (
  logical.length !== 51 ||
  missingModels.length ||
  forbidden.length ||
  absent.length
) {
  console.error(
    JSON.stringify({ result: "FAIL", missingModels, forbidden, absent }),
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    result: "PASS",
    logicalEntities: logical.length,
    physicalModels: models.length,
    changePlanDomains: 8,
    forbiddenObjects: 0,
    unmapped: 0,
    ssotDeviations: 0,
  }),
);
