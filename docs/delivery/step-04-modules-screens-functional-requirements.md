# Step 4 Verdict

PASS. Step 4 closes the V1 functional definition and traceability boundary. Runtime APIs, workflow orchestration, and complete frontend/i18n implementation remain deliberately owned by Steps 7, 8, and 9.

# Canonical Step Boundary

Step 4 specifies modules, screens, actions, states, permissions, business rules, and dependencies. It does not claim that a `CONTRACTED_NOT_IMPLEMENTED` API is already runtime implemented.

# V1 Module Inventory

32 module requirement groups are defined by `scripts/architecture/check-step4-functional-traceability.mjs`: Sales/CRM, Catalog/Pricing/Quotation, ERP Import/DQ/Reconciliation/Orders, Capacity, Logistics, Finance FX/Payments/Cheques, Returns, Documents, Identity, reference data, and their governed supporting modules.

# V1 Screen Inventory

32 functional screen consumers are mapped. The inventory includes Sales Home, Customer 360, Contacts, Projects, Pipeline, Activities, Product Catalog, Pricing Context, Quotations, ERP Import/DQ/Orders, Capacity Estimate, Logistics Planner, FX/Payments/Cheques, Returned Scrap, and governed selectors.

# Functional Requirement Inventory

Stable IDs `FR-*-001` are assigned per functional module group. Each API operation derives a machine-readable record with actor, permission, action, business rules, API, workflow, entity/reference dependencies, and later implementation owner.

# Screen / Action Matrix

The executable traceability matrix maps every operation to its consumer screen and action. Actions remain permission-bound and cover governed create/edit/archive/share/transfer/merge, import/reconciliation, pricing, approval, send, planning, and finance/returns actions.

# Permission Traceability

Every typed operation carries its contract permission into the generated matrix. Country Scope and DENY-wins are common governing rules; no frontend visibility is an authorization substitute.

# API Contract Traceability

`pnpm proof:functional-contract` maps all 198 current inventory operations, including all 133 `CONTRACTED_NOT_IMPLEMENTED` operations. The 21 out-of-scope operations stay explicitly out of V1 runtime.

# Workflow Traceability

Async operations map to a stable workflow requirement and Step 8 ownership. This includes import/DQ, quotation approval/PDF/send, exports, and logistics optimization.

# Data Dependencies

Entity dependencies are declared per module in the executable matrix. Step 5 owns entity-model closure and Step 6 owns physical PostgreSQL closure.

# Reference Data Requirements

Countries, governed selectors, product/pricing inputs, project/pipeline statuses, quotation statuses, return benefit types, and Finance references are requirement-owned. Step 7 provides reference APIs and Step 9 provides selectors.

# Bilingual Requirements

All mapped V1 screens require English/LTR and Arabic/RTL behavior, including layout, tables, forms, dialogs, errors, statuses, pricing, quotation, ERP, Capacity, Logistics, Finance, and Returned Scrap. Runtime i18n is Step 9-owned.

# Functional Acceptance Scenarios

FA-01 Product→Pricing; FA-02 Pricing→Draft; FA-03 Draft→Approval; FA-04 Approved→PDF; FA-05 PDF→SENT; FA-06 SENT→Superseding Draft; FA-07 ERP Upload→DQ→Commit; FA-08 ERP Read-only Facts; FA-09 Capacity Golden Cases; FA-10 Logistics Plan; FA-11 FX; FA-12 Returned Scrap; FA-13 Arabic/English; FA-14 Cross-workspace authorization. Each is a future executable acceptance scenario owned by Steps 7–9, with preconditions, authorized actor, inputs, expected/negative result, and evidence owner derived from the traceability matrix.

# Existing Functionality Reused

Sales Core Customers, Contacts, Projects, Opportunities, Activities, Customer 360, and the generated API client are live. Product Catalog now has a live generated-client list/search/detail surface. All visible navigation points only to these working screens.

# Functional Completeness Matrix

| Module                              | Screen/route           | Runtime status             | Evidence                 | Notes                                                                              |
| ----------------------------------- | ---------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| Sales Home/My Work                  | `/sales`               | IMPLEMENTED                | `SalesCorePage` tests    | Operational lists only; no fake KPI                                                |
| Customers / Customer 360            | `/sales/customers`     | IMPLEMENTED                | PostgreSQL/API/UI tests  | Contacts, projects, opportunities, activities only                                 |
| Contacts                            | context/detail         | IMPLEMENTED                | PostgreSQL/API/UI tests  | Commercial contacts only                                                           |
| Projects                            | `/sales/projects`      | IMPLEMENTED                | PostgreSQL/API/UI tests  | Project country remains separate from Customer HQ                                  |
| Opportunities                       | `/sales/opportunities` | IMPLEMENTED                | PostgreSQL/API/UI tests  | Server stage transitions                                                           |
| Activities                          | `/sales/activities`    | IMPLEMENTED                | PostgreSQL/API/UI tests  | Manual follow-up records only                                                      |
| Sales Management                    | `/sales/management`    | IMPLEMENTED                | Sales Core UI test       | Operational scoped view, no analytics claim                                        |
| Sales Support                       | `/sales/support`       | IMPLEMENTED                | Step 3 permission policy | Scoped Sales operational view                                                      |
| Product Catalog                     | `/sales/products`      | IMPLEMENTED                | Web typecheck/tests      | Generated-client search/list/detail; manage edit waits for ETag contract alignment |
| Pricing                             | none                   | CONTRACTED_NOT_IMPLEMENTED | OpenAPI inventory        | No screen exposed                                                                  |
| Quotations / PDF / Send / Supersede | none                   | CONTRACTED_NOT_IMPLEMENTED | OpenAPI inventory        | No screen exposed                                                                  |
| ERP Import / Orders                 | none                   | CONTRACTED_NOT_IMPLEMENTED | OpenAPI inventory        | No screen exposed                                                                  |
| Capacity / Logistics planner        | none                   | CONTRACTED_NOT_IMPLEMENTED | OpenAPI inventory        | No screen exposed                                                                  |
| FX / Returns                        | none                   | CONTRACTED_NOT_IMPLEMENTED | OpenAPI inventory        | No screen exposed                                                                  |

# Dead UI Scan

Removed visible routes that rendered a generic “contract prepared” page: quotations, targets, intelligence, logistics, operations, and finance. No functional placeholder is exposed in navigation.

# Future Runtime Ownership

Step 5 owns entities/data requirements. Step 6 owns PostgreSQL physical schema. Step 7 owns APIs. Step 8 owns workflows/jobs/state machines. Step 9 owns screens/forms/grids/i18n. Step 10 owns analytics; Steps 11–12 own production evidence and go-live.

# CONTRACTED_NOT_IMPLEMENTED Mapping

The contract audit on 2026-08-22 found 198 inventory operations: 44 runtime implemented, 133 `CONTRACTED_NOT_IMPLEMENTED`, and 21 `OUT_OF_SCOPE_V1`. The following mandatory Step-4 areas are therefore correctly traceable as future runtime work, not hidden placeholders or approved external dependencies:

| Area                    | Contracted runtime operations                                 | Current evidence                       |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------- |
| Pricing                 | resolve, guardrail, manager override, standard-board basis    | no API module, UI, or PostgreSQL suite |
| Quotation lifecycle     | draft, preview, prepare, approval, documents, send, supersede | schema foundation only                 |
| ERP import/DQ and facts | import jobs, DQ, reconciliation, sales orders                 | no parser/worker/API/UI                |
| Capacity                | effective rates and immutable estimates                       | no model/API/UI/golden suite           |
| Logistics plan          | plans, versions, validate, optimize, visualization            | no geometry engine/API/UI              |
| Finance                 | FX, payments, cheques                                         | no API module/UI/evidence              |
| Returned Scrap          | case/request/approval/finalize                                | no API module/UI/evidence              |

Payments/Cheques have typed V1 operations and cannot honestly be reclassified out of scope without an SSOT decision. Arabic/English runtime i18n is also not implemented and remains Step 9-owned.

# Deferred Runtime Evidence by Step

Pricing, Quotation, ERP, Capacity, Logistics, Finance, and Returned Scrap runtime evidence is deferred to Steps 7–9. Full runtime RTL/LTR is deferred to Step 9. Their functional requirements are closed here and must not be waived.

# Existing Runtime Implementations

Sales Home, Customers/360, Contacts, Projects, Opportunities, Activities, Sales Management, Sales Support, Product Catalog, generated-client use, and Ctrl+K behavior remain existing early runtime work. They pass regression but do not redefine the canonical ownership boundary.

# Anti-Regression Validation

The traceability guard requires every operation to have a functional requirement, screen, permission trace, and implementation ownership. It retains no Shipment/Dispatch/Delivery/POD execution, no quotation revisions, no ERP internal order lifecycle, and no unsupported factory workflow.

# SSOT Deviations

0

# Remaining Step-4 Blockers

NONE
