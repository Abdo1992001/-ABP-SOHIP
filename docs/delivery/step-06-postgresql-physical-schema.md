+# Step 6 Verdict

PASS — PostgreSQL 17 / Prisma physical-schema closure.

# Acceptance Boundary

Physical tables, constraints, indexes, immutable history protections, and migration evidence only. APIs/workflows/UI remain Steps 7+.

# PostgreSQL Version

17.11 local Docker PostgreSQL.

# Baseline Migration State

14 migration directories were the repository baseline. The live local history contains 14 prior applied migration records (including prior duplicate historical evidence records); no historical migration was edited.

# New Migrations

`20260822020000_step6_physical_schema`, additive and forward-only.

# Final Migration State

15 migration directories; Prisma deploy/status are clean.

# Step-5 Change Plan Implementation

All 8 domains are in the migration: quotation provenance; ERP/DQ/lineage; capacity; logistics planning; finance; returned scrap; targets; geography/documents.

# Logical → Physical Mapping

49/49 mappings are in [step-06-physical-schema.json](../architecture/step-06-physical-schema.json).

# Physical Entity/Table Inventory

24 new tables plus existing Sales Core, identity, catalog, quotation, audit/outbox/job tables.

# Keys / Foreign Keys / Delete/Archive Policy

Stable UUID technical keys and business unique keys are enforced. Historical commercial links use RESTRICT; existing Customer/Product/Project archive fields remain the active archive convention.

# Unique Constraints / Check Constraints

Source idempotency, business references, allocation identity, monetary/quantity checks, capacity baseline, 0/90 logistics rotation, 25% scrap rate, effective date ordering, and row-version positivity are physical constraints.

# Effective Dating / Row Version / Money / Snapshots

Pricing, FX, capacity and targets use effective timestamps/versioning. Governing editable aggregates retain row version. Money is NUMERIC(18,4), FX NUMERIC(24,12). Quote/approval/document/send and returned-scrap purchase-price snapshots preserve history.

# Sales Core / Catalog / Pricing / Quotation Schema

Customer HQ Country and Project Country remain independent. Product and PricingRule are separate. Quotation has no revision table and has `supersedes_quotation_id`; SENT commercial content and final documents are DB-protected.

# ERP/DQ/Lineage / Capacity / Logistics / Finance / Returns / Targets

ERP facts are importer-owned canonical records with source-system keys and DQ/reconciliation lineage. Capacity is estimate/config only at 900/700/600 and 24 hours. Logistics is plan/version/placement only. Finance contains typed imported Payment/Cheque facts, no ledger. Returns require original quote line and frozen 25% inputs. CompanyTarget only; no PersonalTarget or NetCommercialSales.

# Geography / Reference / Authorization / Documents

Continent and Country are governed reference structures; Country Scope/auth tables remain unchanged. Document bytes stay outside PostgreSQL; metadata and official quotation artifact provenance are persisted.

# Audit / Outbox / Durable Jobs

Existing audit append-only trigger, outbox lease indexes, and durable-job primitives are preserved.

# Explicit SQL Objects / Extensions / Azure Compatibility

PL/pgSQL triggers only; no new extension requirement. SQL is compatible with Azure Database for PostgreSQL Flexible Server 17 and does not require superuser runtime.

# Constraint Tests / Index Verification

`pnpm proof:database` runs against PostgreSQL 17 and checks required tables, forbidden-object absence, FK rejection, capacity baseline, FX pair, ERP quantity, indexes, constraints and migration history.

# Schema Drift / Fresh Database / Existing Database Upgrade

The forward migration is deployed in place. A disposable PostgreSQL 17 database (`abp_step6_fresh`) applied all 15 migration directories from zero and reported `Database schema is up to date`. The existing local `abp` database upgraded in place and also reports up to date. No reset/drop of the working database was used.

# Step 1–5 Regressions / pnpm verify

Run as final evidence after Prisma generation. No SSOT deviation is introduced.

# Step-7 Backend Handoff

[step-07-api-data-readiness.json](../architecture/step-07-api-data-readiness.json) records 133 contracted operations as data-ready at aggregate/schema level.

# Remaining Step-6 Blockers

NONE for the local physical schema.
