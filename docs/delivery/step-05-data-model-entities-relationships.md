# Step 5 Verdict

PASS — logical model closure only; physical reconciliation is explicitly handed to Step 6.

# Acceptance Boundary

Logical entities, aggregate ownership, cardinalities, lifecycle, snapshot, effective-date, lineage, archive, and concurrency requirements are closed here. No DDL or migration change is claimed.

# Existing Model Reused

Existing Prisma models provide aligned foundations for identity, Sales Core, catalog, pricing, quotation foundation, audit/outbox/jobs, and Country Scope. Missing future physical concepts are logical requirements, not Step-5 runtime defects.

# Entity Inventory / Aggregate Inventory / Entity Classification

`pnpm proof:data-model` owns the machine-readable inventory: 49 logical entities grouped under their business aggregate and classified as transactional, imported canonical fact, reference, configuration, snapshot, relationship, document metadata, or technical/platform.

# Sales Core

Customer (business alias of physical Account) is canonical. Customer 1:N Contacts, Projects, Opportunities, Activities, and governed Group Memberships. Contact is never an ApplicationUser. Project geography is independent from Customer HQ; Opportunity project is optional. WON contribution is immutable and is the only Target-achievement source.

# Product Catalog / Pricing

ProductFamily 1:N Product; Product 1:N effective-dated PricingRule. Pricing is separate from Product and Quote snapshots. Pricing configuration carries a governed effective 5% discount threshold rather than an uncontrolled key-value store.

# Quotations

Quotation 1:N Lines/Adjustments and 0:N Approval/OfficialDocument/SendEvent. A line references Product but snapshots quote-time commercial meaning. Draft is mutable; SENT is immutable. `supersedes_quotation_id` is the only post-SENT change relation; no formal revision entity exists.

# ERP / DQ / Lineage

ImportBatch 1:N ImportRows/DQIssues; ERPOrder 1:N ERPOrderLines. Orders are imported canonical read-only facts, with source fingerprint/row lineage, mapping/reconciliation, conflict resolution, and quantity basis (Booked/Shipped/Invoiced/Interfaced/Remaining). No internal order lifecycle exists.

# Capacity / Logistics / Finance / Returned Scrap / Targets

CapacityRate is effective-dated configuration (900/700/600 at 24h); CapacityEstimate is derived/planning only. LogisticsPlan/Version/Placement are planning-only shared 2D/3D placement truth; no Shipment/POD/Dispatch/Delivery model. FXRate is effective-dated and versioned; Payments/Cheques remain Finance-isolated imported/canonical facts without ledger claims. ReturnedScrapRequest/Item snapshots original quotation line and purchase price at 25%, with manager approval. CompanyTarget/TargetAllocation are versioned; PersonalTarget and NetCommercialSales are absent.

# Geography / Reference / Authorization

Country derives Continent and Local/Global (Egypt Local, external Global, missing Unclassified/DQ). Region groups are not continents. Country Scope remains a separate User:N Country relation; role, ownership, manager context, and sharing cannot widen it.

# Documents / Audit / Outbox / Jobs

DocumentMetadata has controlled owner/storage/classification metadata; OfficialQuotationDocument is immutable. AuditEvent is append-only; OutboxMessage and DurableJob remain cross-domain technical aggregates.

# Snapshots / Effective Dating / Concurrency / Archival

Quotation pricing/FX/tax/payment/validity/product, WON, Return original price, and official-document content-hash snapshots preserve historical truth. Pricing/FX/Capacity/Target configuration use validFrom/validTo/version. Editable commercial/security aggregates require row-version; historical business records archive rather than hard-delete.

# Data Classification / Identifiers

Reference, Internal, Confidential, Finance, Restricted, and Security classification guide later projection. Technical UUIDs are distinct from business/external keys (Customer code, SKU, quotation reference, ERP order number); money is amount plus currency and never binary float.

# Functional Requirement / API Operation Traceability

`pnpm proof:data-model` maps all 32 Step-4 requirement groups and all 198 typed API operations to logical aggregates. All 133 Step-7 operations have data support.

# Current Prisma Reconciliation / Step-6 Physical Change Plan

Aligned: Sales Core, Identity, Country Scope, Product/Pricing, Quotation foundation, Audit/Outbox/Jobs. Step-6 changes: physical tables and constraints for quotation approvals/documents/send events, ERP import/DQ/reconciliation/orders, capacity/logistics, FX/payments/cheques, returns, targets, reference governance, and document metadata. Each requires forward migration, lineage/data backfill assessment, and no destructive shortcut.

# Logical ERD

See [step-05-logical-erd.md](../architecture/step-05-logical-erd.md).

# Forbidden Entity / Duplicate Truth Scan

No active QuotationRevision, internal ERP lifecycle, production/MES/QC/work-order, Shipment/Dispatch/Delivery/POD, PersonalTarget, or NetCommercialSales canonical model. Account is the physical Customer alias, not duplicate truth; Product/Pricing and reference/snapshot data are deliberately separate.

# Step 1–4 Regressions / pnpm verify / SSOT Deviations

All required guards remain in `pnpm verify`. SSOT deviations: 0.

# Remaining Step-5 Blockers

NONE.
