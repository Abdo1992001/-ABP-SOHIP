# Step 7 — Backend / API Runtime Closure

## Verdict evidence

- Starting verified state for this continuation: 116 / 177 mandatory V1 operations.
- Returned Scrap closure: 123 / 177.
- Company Target closure: 127 / 177.
- Exact residual audit: 50 operations across AI (2), Analytics (5), Audit (2), CRM Service complaints (5), CRM group networks (3), Dashboard (1), Documents (6), Exports (2), Identity (15), Notifications (3), Preferences (2), Projects (3), Search (1).
- Final runtime inventory: 177 / 177 mandatory V1 operations; 21 operations remain explicitly `OUT_OF_SCOPE_V1`.
- `CONTRACTED_NOT_IMPLEMENTED=0`, `PARTIAL=0`, `DEFECT=0`, `UNRESOLVED=0`.

## Runtime completed in the final closure

- Project party/contact-role relations with stored-parent validation, Country Scope, idempotency, ETag/If-Match, soft ending and Audit.
- Effective-dated group/network membership with account scope and Audit.
- Complaint list/detail/create/update/transition with customer/case scope, manager-only close permission, concurrency and idempotency.
- Users, roles, permissions, lifecycle, invitation boundary, country access, role assignment, session revocation and logout with DENY, policy-version invalidation, Audit and Security Events.
- Self-only notifications/preferences, advisory-only AI outputs, scoped action queue and global search.
- Server-side governed reports/metrics with source/basis/scope metadata; no frontend KPI authority and no Net Commercial Sales metric.
- Private document upload sessions with filename/media/size limits, independently observed size, SHA-256 and MIME detection, durable malware-scan boundary, resource-scoped metadata/download/linking.
- Scoped exports persist the effective country/filter snapshot and queue a durable job/outbox event; no fake completion.
- Workers claim only registered event/job types. Step-8-owned command boundaries remain pending with zero attempts until their owning handler exists, instead of being falsely completed or exhausted as dead work.

## Forward database support

- `20260822036000_step7_returned_scrap_runtime`
- `20260822036100_step7_returned_scrap_default_alignment`
- `20260822037000_step7_targets_runtime`
- `20260822038000_step7_support_runtime`
- PostgreSQL 17 upgrade path: 31 migrations applied; migration status current.

## Security and negative evidence

- Server authorization order remains session → Country Scope → workspace → RBAC → DENY → resource context → field projection → state rule.
- Complaint, project party, document and search queries enforce country/resource scope in PostgreSQL queries; hidden IDs return not found.
- Project contact-role creation rejects a contact from another account.
- Governed mutations enforce `rowVersion`/ETag or request `expectedRowVersion`; stale preference/complaint/project mutations return 412.
- Retryable create/command boundaries persist command idempotency and reject key reuse with a different fingerprint.
- Finance reports require both report and finance permissions. Sensitive raw source/security payloads are not projected.

## Contract and runtime evidence

- OpenAPI operations: 177 typed; unresolved refs 0; duplicate operation IDs 0; GenericObject 0; placeholders 0; `additionalProperties: true` 0.
- Generated client drift: 0.
- Support PostgreSQL proof covers Projects, Groups, Complaints, Identity, Notifications, Preferences, AI, Search, Audit/Security, Analytics, Documents and Exports.
- Domain proofs cover Customer, Contact, Project, Opportunity, Pricing, ERP Import/DQ/Reconciliation, Capacity, Logistics, Finance, Returned Scrap and Targets.
- Workflow handoff is recorded in `docs/architecture/step-08-workflow-handoff.json`: 14 mapped, 0 unmapped. Step 8 was not implemented.
- Docker API, Worker, Web and migration images build from dependency-cached layers. Runtime evidence confirms PostgreSQL 17 healthy, 31 migrations current, API/Worker readiness HTTP 200, Web HTTP 200, pending workflow events unclaimed, and zero unregistered-handler/dead-event worker errors.

## SSOT anti-regression

- No Formal Quotation Revisions.
- ERP Orders remain imported read-only facts.
- Capacity remains Standard 900 / Ordinary 700 / Curved 600 at 24 hours/day, estimate only.
- Logistics remains planning only, Flat-on-Face, rotations 0/90; no Shipment/POD.
- Country Scope remains mandatory and cannot be widened by ownership/share/manager context.
- Returned Scrap remains 25% of original quotation-line purchase unit price with manager approval.
- ACROW Company Target remains USD-primary and achieved by Opportunity WON only; no personal target.
- SSOT deviations: 0.
