# CR-001 — Design Decision Closure Pack

Status: `BUSINESS APPROVED — IMPLEMENTED`

Final note (2026-08-25): all ten gates are closed. The original option analysis below is retained as historical decision provenance; the authoritative approved choices are recorded in `cr-001-design-decision-register.json#finalBusinessApproval`. Step 12 remains not started and Production Ready remains NO.

Generated from the current CR-001 partial implementation, the authoritative R1 source registry, the approved CR-001 text, the current OpenAPI/runtime inventory, PostgreSQL migrations, and current source code. Quarantined and superseded branches are evidence of historical conflict only; they are not authority.

This document does not change production behavior, approve a design option, start Step 12, or change any Release Gate.

## Authority boundary

The following rules remain authoritative throughout this pack:

- No formal quotation revisions. A DRAFT is edited in place; SENT is immutable; later change creates a separate quotation linked with `supersedes_quotation_id`.
- ERP Sales Orders remain imported, read-only facts. CR-001 shipment tracking must not create an internal order lifecycle.
- Quotation cancellation remains outside V1.
- Country Scope is evaluated server-side before ownership/share/manager rules; DENY wins.
- Local/Global is a business and reporting classification, never an authorization grant.
- The new CR-001 Local set is Egypt, Libya, Saudi Arabia, and the United Arab Emirates. A missing country is Unclassified.
- Client Portal isolation must be enforced by a canonical identity-to-customer binding, never by frontend filtering.
- R&D is view-only. Pricing, cost, margin, Finance, writes, approvals, and commercial administration are denied unless a later explicit authority changes that rule.
- The historical Step 2–5 revision/internal-order/shipment branch is superseded by Steps 6–12. It cannot answer the new CR-001 design questions.

## RUNTIME-DELTA-001

Status: `VALID`

| Field                   | Result                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation ID            | `post_quotations_by_quotationId_cancel`                                                                                                                                                                                                                      |
| Route                   | `POST /quotations/{quotationId}/cancel`                                                                                                                                                                                                                      |
| Previous classification | `IMPLEMENTED`, mandatory V1 runtime operation in OpenAPI 1.4.0                                                                                                                                                                                               |
| Current classification  | `OUT_OF_SCOPE_V1` in OpenAPI 1.5.0                                                                                                                                                                                                                           |
| Source files            | Historical route contract `docs/contracts/openapi/paths/quotations_{quotationId}_cancel.yaml`; current classification `docs/contracts/out-of-scope-v1.yaml`; inventories `docs/contracts/api-inventory.json` and `docs/contracts/runtime-v1-operations.json` |
| Change type             | Functionality removed from enabled runtime and reclassified; not renamed or consolidated                                                                                                                                                                     |
| Count effect            | Mandatory `198 → 197`; out-of-scope `21 → 22`                                                                                                                                                                                                                |
| Related change          | CR-001-05 Quotation Status                                                                                                                                                                                                                                   |
| Authority               | Approved CR-001 invariant and CR-001.md both state that Cancel remains out of V1                                                                                                                                                                             |

The source path file remains as historical contract evidence but is no longer referenced by the canonical OpenAPI. Runtime proof expects this route to return 404. This is an explicitly authorized boundary correction, not a cosmetic terminology change.

## COMPLAINT-STORAGE-AUDIT

Status: `PASS` for canonical persistence and API behavior.

| Layer              | Evidence                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical entity   | Prisma `Complaint`                                                                                                                                                                                                                          |
| Physical table     | `complaints`                                                                                                                                                                                                                                |
| Existing migration | `packages/database/prisma/migrations/20260822038000_step7_support_runtime/migration.sql`                                                                                                                                                    |
| Aggregate          | Standalone Complaint case aggregate, related to Account and optionally Project, imported Sales Order and Contact                                                                                                                            |
| Repository         | Typed Prisma access through `DatabaseClient.complaint` inside `EngagementService`; there is no separate repository class                                                                                                                    |
| Service            | `apps/api/src/support/engagement.service.ts`                                                                                                                                                                                                |
| API                | List, create, detail, update, and status transition operations under `/complaints`                                                                                                                                                          |
| Authorization      | `complaints.view/create/edit/close`; SALES workspace; Country Scope first; case context limited to owner, account owner, or active account share; DENY is enforced by the effective identity                                                |
| Concurrency        | `row_version`, response ETag, `If-Match` for update, and `expectedRowVersion` for transitions                                                                                                                                               |
| Idempotency        | Required for create and status transition; persisted command idempotency record                                                                                                                                                             |
| Audit              | Structured audit events for create, update, and status change through `AuditService`                                                                                                                                                        |
| Tests              | PostgreSQL-backed `support-proof-cli.ts` covers create, detail, update, transition and list; OpenAPI/runtime contract checks cover all five operations                                                                                      |
| Frontend           | No dedicated `/complaints` screen exists in the current 48-screen registry. Complaint operations exist in the generated client but are not wired to a dedicated management page. This is a frontend completeness gap, not a storage defect. |

The existing Complaint entity is semantically correct for the approved standalone case lifecycle `OPEN → IN_REVIEW → RESOLVED → CLOSED`. It does not invent SLA, priority policy, assignment workflow, notification workflow, attachment policy, or portal visibility.

## DG-01 — Customer Segment

Current status: `BUSINESS DECISION REQUIRED`

### Already resolved facts

- CR-001 replaces the affected Product Mix presentation with Customer Segment.
- Step 10 recognizes Formwork and Loose Boards as real segment labels and anticipates future configurability/history.
- Customer Segment membership is not the same as existing Account Category or pricing `customer_segment` context.
- Analytics truth must be server-side. Country Scope and DENY apply before aggregation.

### Unresolved questions

Taxonomy type and owner; canonical codes; assignment/change permissions for Sales User, Sales Support and Sales Manager; import authority; unknown-code handling; effective dating; historical analytics mode; audit; archive; code immutability.

### Taxonomy options

| Option                                | Business effect                           | Analytics effect                                                 | Data model / migration                                                            | Security                                                    | Complexity                          |
| ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| A — Fixed canonical list              | Only release-managed segments are allowed | Stable dimensions but every taxonomy change needs deployment     | Seeded reference table plus membership table                                      | Changes limited to technical release authority              | Low runtime, high change friction   |
| B — Admin-configurable reference list | Approved admins can add/archive segments  | Versioned codes remain stable; archived values remain reportable | Reference table, effective-dated membership, archive state, audit and constraints | Dedicated taxonomy-manage and membership-manage permissions | Medium                              |
| C — Free text                         | Users/imports can type anything           | Fragmented values and unreliable grouping                        | Text field or uncontrolled mapping                                                | Broad write surface and typo abuse                          | Low initial, high permanent DQ cost |

Recommendation, not approval: **B**. Use immutable canonical codes after first use, editable labels, archive rather than delete, and effective-dated Customer-to-Segment membership.

### Assignment and import options

| Option | Assignment authority                                                  | Import behavior                                                             | Effect                             |
| ------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| A      | Sales Manager only                                                    | Import may propose; unknown values become DQ                                | Tight control, slower operations   |
| B      | Sales Manager + governed Data Steward; Sales User/Support may propose | Known codes can assign only under approved mapping; unknown codes become DQ | Balanced governance and throughput |
| C      | Sales User, Support and Manager directly assign                       | Imports create new values automatically                                     | Fast but weak taxonomy integrity   |

Recommendation, not approval: **B**. Never auto-create a segment from an unknown import value.

### History options

| Option              | Analytics behavior                                     | Data impact                                 | Operational effect                   |
| ------------------- | ------------------------------------------------------ | ------------------------------------------- | ------------------------------------ |
| A — Latest only     | Old activity moves when membership changes             | Current field only                          | Simple but historical reports change |
| B — As-was only     | Event-date membership is authoritative                 | Effective-dated membership                  | Reproducible, less flexible          |
| C — Both selectable | Default As-Was plus explicit Current-Reclassified mode | Effective dates, stable code and query mode | Most useful and most complex         |

Recommendation, not approval: **C**, defaulting to As-Was.

### Cross-layer impact

- Data model: `customer_segments` plus effective-dated `account_segment_memberships`; no reuse of Account Category.
- API: typed reference list, membership history, assign/end commands, DQ mapping contract.
- Workflow: approval/proposal behavior depends on selected authority option.
- Frontend: governed selector and history; no hardcoded list.
- Analytics: explicit `AS_WAS`/`CURRENT_RECLASSIFIED` mode if Option C is approved.
- Security: separate taxonomy-management and membership-management permissions, still intersected with Country Scope.
- Migration: expand-only reference/membership tables and an approved backfill source; no guessed backfill.
- External dependency: authoritative source owner and import mapping owner.

Exact business decision required: select taxonomy Option A/B/C, assignment/import Option A/B/C, history Option A/B/C, taxonomy owner, canonical initial codes, and direct permissions for Sales User, Sales Support and Sales Manager.

## DG-04 — Quotation Submitted / Under Negotiation

Current status: `BUSINESS DECISION REQUIRED`

### Already resolved facts

- DRAFT is mutable in place. SENT is immutable.
- A change after SENT creates a separate DRAFT using `supersedes_quotation_id`; there is no Revision 2 entity.
- Approval is content/hash-bound. Official document generation must succeed before SENT is recorded.
- Quotation cancellation is outside V1.
- Hot Lead, WON and LOST belong to Opportunity, never Quotation.
- Every mutation requires server authorization and optimistic concurrency; retryable commands need idempotency.

### Semantic options

| Option | Submitted                                                        | Under Negotiation                                                    | Sent                                                           | Main risk                                                                   |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A      | Submitted internally for approval                                | Approved content is being commercially negotiated before final issue | Official immutable document delivered/recorded                 | Requires clear rule for edits during negotiation                            |
| B      | Commercially submitted to customer                               | Customer negotiation after that submission                           | Separate delivery-evidence event, not a second lifecycle state | “Submitted” and “Sent” become overlapping concepts                          |
| C      | Submitted for internal commercial review, separate from approval | Engagement phase held outside quotation, normally on Opportunity     | Official immutable quotation state                             | Does not satisfy a requirement that Under Negotiation be a Quotation status |

Recommendation, not approval: **A** if both new quotation statuses are mandatory. Treat Submitted as internal submission, Sent as external official issue, and require a return to DRAFT plus reapproval for any material edit during negotiation.

### Proposed graph for approval, not authority

`DRAFT → SUBMITTED → APPROVED → UNDER_NEGOTIATION → SENT`

Allowed controlled backward movement: `SUBMITTED → DRAFT` on rejection/withdrawal and `UNDER_NEGOTIATION → DRAFT` when content must change. Returning to DRAFT invalidates stale approval and official-document readiness. `SENT` never moves backward.

Alternative if Option C is selected: keep the existing quotation lifecycle and place UNDER_NEGOTIATION only on Opportunity; do not add a misleading quotation state.

### Decisions still required

1. Choose the exact meaning of Submitted and whether Under Negotiation is a Quotation state or Opportunity engagement phase.
2. Approve every forward/backward transition and actor.
3. Decide whether Submitted freezes content.
4. Decide whether negotiation edits happen on the same pre-SENT quotation, require return to DRAFT, or are forbidden.
5. Confirm the transition that triggers approval, official-document generation, and external send evidence.
6. Approve ETag and idempotency requirements per transition.

### Cross-layer impact

- Data model: status enum/history and content-hash-bound approval/document links; no revisions table.
- API: typed transition commands, ETag/rowVersion and idempotency keys.
- Workflow: explicit guards, actors, rollback-to-draft consequences, document and send prerequisites.
- Frontend: truthful state banner and only authorized actions; no fake Sent success.
- Analytics: Submitted, negotiation and Sent timestamps must not be conflated.
- Security: edit, submit, approve, generate and send remain separate permissions.
- Migration: enum/state backfill requires an explicit mapping for existing quotations.
- External dependency: actual send provider may remain external, but SENT needs authoritative evidence under the existing send contract.

Exact business decision required: approve semantic Option A/B/C and the complete transition/actor/edit/freeze/approval/document/idempotency matrix.

## DG-05 — Shipment Tracking

Current status: `BUSINESS DECISION REQUIRED`

### Already resolved facts

- CR-001 authorizes design for the milestones Ready for Delivery, Shipped, Vessel Departed, and Arrived at Port of Discharge.
- The pre-CR baseline excluded Shipment/POD execution. CR-001 is the only authority for adding the new minimum tracking scope.
- ERP Orders remain imported read-only facts.
- Dispatch, Delivery, POD, GPS, driver, customs workflow, last-mile delivery and warehouse picking remain unauthorized.
- Existing logistics planning remains separate from shipment tracking.

### Cardinality options

| Option                                                                            | Business effect                                                | Data/API effect                                      | Complexity          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| A — Shipment belongs to one ERP Order; an order may have many shipments           | Supports partial shipments but not consolidation               | Direct `sales_order_id` plus optional shipment lines | Low                 |
| B — Shipment may contain many ERP Orders; each order may appear in many shipments | Supports consolidation and split fulfillment                   | Shipment plus allocation join table                  | Medium/high         |
| C — One-to-one                                                                    | Simplest but cannot represent partial or consolidated shipping | Unique foreign key                                   | Low but restrictive |

Recommendation, not approval: **B** only if consolidation is a real Acrow process; otherwise **A**. Do not pay the many-to-many cost without business confirmation.

### Milestone event options

| Option                                                             | Correction behavior            | Audit effect           | Recommendation            |
| ------------------------------------------------------------------ | ------------------------------ | ---------------------- | ------------------------- |
| A — Overwrite current timestamps                                   | Easy but destroys prior truth  | Weak                   | Not recommended           |
| B — Append milestone/correction events and project current state   | Complete provenance            | Strong                 | Recommended, not approved |
| C — Immutable milestone; correction only by administrator data fix | Rigid and operationally costly | Strong but impractical | Not recommended           |

For Option B, store user-entered `occurred_at` separately from system `recorded_at`, actor, source and correction reason.

### Required business decisions

- Shipment/order cardinality and source of shipment reference.
- Creator/editor and exact Sales, Logistics and Operations permissions.
- Portal visibility, deferred until DG-08.
- Required fields at every milestone.
- Whether BL Date is mandatory at Vessel Departed and whether BL Number is approved.
- Whether Port of Discharge is governed reference data; recommendation is a protected port/UN-LOCODE reference with controlled fallback/DQ, not arbitrary free text.
- Whether actual arrival date is mandatory.
- Manual versus imported timestamps, backdating limits and correction approval.
- Evidence requirement and exact permitted document types. POD is explicitly excluded.

### Cross-layer impact

- Data model: shipment header, ERP-order allocation, append-only milestone events and optional authorized document links.
- API: scoped list/detail/create/update and milestone-event commands; no ERP order mutation.
- Workflow: monotonic milestone guards plus correction event policy.
- Frontend: Logistics edit workspace; Sales/Operations/Portal projections only as approved.
- Analytics: milestone counts/durations only after date semantics and DQ rules are approved.
- Security: Country Scope, resource projection, separate view/edit/milestone permissions and IDOR tests.
- Migration: new expand-only aggregate; no reuse of quarantined shipment tables.
- External dependency: authoritative source/owner for shipment reference, milestones, ports and evidence.

Exact business decision required: approve cardinality, shipment identity, actor/permission matrix, milestone required-field matrix, timestamp/correction/backdating policy and evidence policy.

## DG-07 — External Client Identity

Current status: `BUSINESS/SECURITY DECISION REQUIRED`

### Already resolved facts

- Microsoft Entra ID OIDC is the reference internal IdP.
- MFA is mandatory; local username/password authentication is not an authorized fallback.
- BFF HttpOnly sessions are server-side and PostgreSQL-backed.
- External users require a separate explicit customer-binding and revocation model; internal Sales grants cannot be reused.

### Viable options

| Option                                 | Security implications                                                    | Azure implications                                                                                        | Effort      | DEP-001 / Production impact                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| A — Microsoft Entra External ID / CIAM | Purpose-built customer boundary, customer journeys and policy separation | External tenant/configuration, app registrations, Conditional Access/MFA policy, lifecycle and monitoring | Medium/high | Requires tenant/licensing/consent and external policy evidence before portal release                       |
| B — Entra B2B invitations              | Strong enterprise identities and fast start for known customer users     | Guest objects in workforce tenant, invitation/redemption and guest governance                             | Medium      | Requires guest governance, terms, review and offboarding evidence; may be awkward at larger customer scale |

Recommendation, not approval: **A** for a durable customer portal; **B** only for a small, known, invitation-only population where IT accepts guest lifecycle overhead.

### Decisions still required

- Identity option A or B and owning tenant/security team.
- Invitation/provisioning authority and customer-binding approver.
- One identity to one customer versus explicit multiple active bindings.
- Multiple Client Users per Customer.
- External session idle/absolute lifetime and step-up policy. MFA itself is already mandatory.
- Recovery/helpdesk process, revocation owner and required revocation propagation target.
- Customer-company admin capability, if any.
- Internal admin role for bindings and periodic access review.
- External-user audit retention and security-event requirements.

Recommendation, not approval: model binding independently from the IdP subject, effective-date it, audit every invite/bind/revoke, and make revocation invalidate server sessions immediately.

### Cross-layer impact

- Data model: external identity subject, invitation/provisioning state, customer binding, validity, revocation and audit.
- API: no public identity-management API until provider and admin boundaries are approved.
- Workflow: invite → redeem → bind/approve → active → suspend/revoke.
- Frontend: isolated portal shell and recovery/support states.
- Analytics: external usage telemetry must not become commercial truth.
- Security: tenant boundary, MFA, BFF session, CSRF, IDOR, rate limiting, abuse and immediate revocation tests.
- Migration: no guessed client-user seed; onboarding is governed after identity selection.
- External dependency: DEP-001 is directly blocking.

Exact business decision required: select identity option, tenant boundary, provisioning/binding authority, multiplicity, session/recovery/revocation policy and any customer-admin role.

## DG-08 — Client Portal Projections / Actions

Current status: `BUSINESS DECISION REQUIRED`

### Already resolved minimum scope

Client users may view their own Orders and Order Status, view their own permitted Shipment Status, create Complaints, view their own Complaints, and track their own Complaints. The server binding is:

`External Identity → Active Client Account Binding → Canonical Customer → Explicit Projection`

Every query must start from the active binding. A supplied customer ID or guessed resource ID never widens scope.

### Field/action classification

`UNRESOLVED` means deny-by-default until approved.

| Data/action                      | Classification | Boundary                                               |
| -------------------------------- | -------------- | ------------------------------------------------------ |
| Orders                           | ALLOW          | Own canonical Customer only; read-only                 |
| Order Status                     | ALLOW          | Own orders; trusted ERP status only                    |
| Shipment Status                  | ALLOW          | Own permitted shipment projection after DG-05          |
| Complaint create/view/track      | ALLOW          | Own Customer and own/authorized complaint context      |
| Financial balances               | DENY           | No approved portal financial contract                  |
| Payment                          | DENY           | No approved minimum scope                              |
| Cheque                           | DENY           | No approved minimum scope                              |
| Order line quantities            | UNRESOLVED     | Exact projection not approved                          |
| Order monetary value/prices      | UNRESOLVED     | Finance/commercial sensitivity decision required       |
| Quotation / Quotation PDF        | UNRESOLVED     | Not in minimum portal scope                            |
| Invoice                          | UNRESOLVED     | No portal accounting contract                          |
| BL Date / Port of Discharge      | UNRESOLVED     | Depends on DG-05 and privacy decision                  |
| Shipment documents / BL document | UNRESOLVED     | Download and document projection not approved          |
| Project                          | UNRESOLVED     | No portal project projection approved                  |
| Contacts                         | UNRESOLVED     | Personal-data projection not approved                  |
| Complaint attachment             | UNRESOLVED     | File policy/scanning/retention not approved            |
| Product/SKU                      | UNRESOLVED     | Exact fields not approved                              |
| Export / Download                | UNRESOLVED     | Reauthorization, watermark and audit decision required |

### Options requiring approval

- Binding multiplicity: one portal identity to one Customer, or explicit many-to-many bindings with a customer switcher.
- Search: scoped exact/prefix search only, or broader full-text over permitted records.
- Pagination: recommendation is server-side stable offset pagination for grids, matching current UI conventions.
- End of relationship: immediate hide/revoke, fixed read-only retention window, or legal-policy-based retention.
- Documents and exports: none; individually authorized downloads; or governed exports with reauthorization/audit.

### Cross-layer impact

- Data model: relies on DG-07 binding plus per-resource provenance and document authorization.
- API: separate portal DTOs/endpoints or explicit external projections; never reuse internal DTOs blindly.
- Workflow: complaint creation and tracking only; no order mutation.
- Frontend: separate portal route/layout with no internal navigation leakage.
- Analytics: portal activity is operational telemetry only.
- Security: server isolation, field omission, IDOR/BFLA tests, rate limits, file scanning and export reauthorization.
- Migration: none until identity/binding and exact projections are approved.
- External dependency: DG-07 and DEP-001.

Exact business decision required: resolve every UNRESOLVED field/action, multiplicity, search, pagination, post-relationship retention and download/export policy.

## DG-09 — R&D Dataset / Most Requested Sizes

Current status: `BUSINESS DECISION REQUIRED`

### Already resolved facts

- R&D is internal view-only.
- R&D requires Most Requested Sizes and Complaint insights.
- Pricing, cost, margin, Finance, writes, approvals and commercial administration are denied.
- Country Scope and DENY remain mandatory unless a later explicit security authority defines a narrower aggregate-only model.

### Candidate bases for Most Requested Sizes

| Basis                              | Business meaning                    | Bias/risk                                                          | Current data availability                                                 |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A — All DRAFT quotation lines      | Early expressed demand              | High noise, abandoned drafts and repeated edits                    | Available but unsuitable as stable demand truth                           |
| B — Submitted quotation lines      | Internally reviewed demand          | Depends on unresolved Submitted semantics                          | Blocked by DG-04                                                          |
| C — SENT quotation lines           | Demand formally issued to customers | Excludes early demand; repeat/superseded quotes need rules         | Canonical SENT snapshots available                                        |
| D — Opportunity demand lines       | Earliest technical demand           | No locked canonical demand-line contract                           | Not authoritative today                                                   |
| E — WON quotation/order quantities | Converted commercial demand         | Strong conversion bias; may miss rejected demand useful to R&D     | Opportunity WON and quote links exist, exact quantity basis needs mapping |
| F — ERP Booked quantities          | Real booked demand                  | Lagging indicator; misses requested-but-not-won innovation signals | Trusted ERP facts available after DQ/reconciliation                       |

Recommendation, not approval: publish two separately named measures rather than overload one metric: (1) `Requested Size Frequency` = distinct SENT quotations containing the canonical size, and (2) `Requested Size Quantity` = summed SENT quotation-line quantity. Keep ERP Booked Size Quantity as a separate realized-demand metric.

### Decisions still required

- Select basis/bases and whether frequency, quantity or both are needed.
- Date basis: quote sent date, opportunity won date, ERP booked date or another approved event.
- Canonical size key and unit normalization.
- Customer/country visibility and minimum cohort.
- Customer identity visibility versus anonymized aggregate.
- Complaint customer identity and exact complaint/product fields.
- Export, drilldown, audit and retention.
- Whether Local/Global split is allowed.

Recommendation, not approval: aggregate by canonical product dimensions, apply Country Scope, suppress customer identity by default, require a minimum cohort for drilldown, deny raw export initially, and expose complaint category/product/severity/status without commercial fields.

### Cross-layer impact

- Data model: no duplicate R&D facts; semantic views reference canonical quote/ERP/complaint facts.
- API: dedicated read-only projection with basis/version/asOf/scope metadata.
- Workflow: none; advisory analytics only.
- Frontend: R&D-only view with no write controls.
- Analytics: separate metric IDs for frequency, requested quantity and booked quantity.
- Security: field omission, cohort suppression, Country Scope, DENY, export and drilldown audit.
- Migration: semantic registry/version changes only unless an approved snapshot/materialization is required.
- External dependency: R&D data owner, privacy/security approval and retention policy.

Exact business decision required: choose metric basis, measure, date, identity/cohort projection, complaint/product fields, export/drilldown, audit, retention, Country Scope and Local/Global visibility.

## DG-10 — Local / Global History / Effective Dating

Current status: `BUSINESS DECISION REQUIRED`

### Already resolved facts

- Current CR-001 rule: LOCAL = EG, LY, SA, AE; GLOBAL = every other known country; missing country truth = UNCLASSIFIED plus DQ.
- Country and Continent come from server reference truth.
- Customer HQ geography and Project geography are distinct dimensions.
- Local/Global never changes Country Scope authorization.

### Historical options

| Option                   | Report behavior                                              | Reproducibility         | Data/migration effect                                         |
| ------------------------ | ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------- |
| A — Historical As-Was    | Old events retain classification valid on event date         | Strong                  | Effective-dated rule/version and event-date resolution        |
| B — Current Reclassified | All history changes when the rule changes                    | Weak for issued reports | Current rule only; cheap                                      |
| C — Both modes           | Default As-Was plus explicitly selected Current-Reclassified | Strong and flexible     | Versioned rules, query mode and optional snapshot/version key |

Recommendation, not approval: **C**, with As-Was as the default and exported reports storing classification version, mode and asOf.

### Decisions still required

- Effective date for the four-country Local definition.
- Historical Option A/B/C.
- Whether country classifications are governed effective-dated reference records.
- Whether persisted analytics snapshots store the classification version.
- Whether old issued reports may change after reclassification.
- Metric/report geography matrix: Customer HQ for customer-centric reports; Project Country for project/demand reports; any other source must be explicitly registered.
- Export reproducibility and exact asOf semantics.
- Golden-dataset backfill expectations.

### Cross-layer impact

- Data model: versioned/effective-dated classification rule and optional snapshot version references.
- API: `classificationMode`, `classificationVersion`, `asOf` and `geographyBasis` metadata where applicable.
- Workflow: governed reference-data change with analytics-impact review.
- Frontend: visible mode/basis; no frontend classification calculation.
- Analytics: deterministic historical/current modes and report-specific geography basis.
- Security: no effect on Country Scope grants.
- Migration: approved effective-date seed and optional historical backfill; never infer dates.
- External dependency: Business Owner effective date and analytics owner report-basis approval.

Exact business decision required: effective date, historical Option A/B/C, version/snapshot policy, report geography matrix, export reproducibility and asOf behavior.

## Recommendation trade-offs

Every row below is a technical recommendation only, not approval.

| Gate  | Recommended technical option                                                                                    | Pros                                                                                     | Cons                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| DG-01 | Configurable canonical taxonomy, governed assignment, effective-dated membership, both historical modes         | Stable codes, auditable changes, reproducible and reclassifiable analytics               | More tables, permissions and stewardship work                    |
| DG-04 | Submitted = internal approval submission; negotiation edits return to DRAFT; Sent = immutable external issue    | Clear separation of internal approval and client commitment; preserves SENT immutability | More transitions and reapproval cycles; requires user training   |
| DG-05 | Append-only milestone events; use one-order/many-shipments unless consolidation proves many-to-many is required | Traceable corrections without premature aggregate complexity                             | Business must confirm real consolidation before schema closure   |
| DG-07 | Entra External ID/CIAM for a durable portal                                                                     | Clean external boundary and better customer lifecycle                                    | Higher Azure/identity setup effort and direct DEP-001 dependency |
| DG-08 | Dedicated external projections, deny-by-default fields and no exports initially                                 | Strong isolation and minimal disclosure                                                  | Smaller initial portal and additional DTO/API surface            |
| DG-09 | Separate SENT-request frequency and quantity metrics; separate ERP booked metric; anonymized aggregate first    | Avoids mixing requested and realized demand; safer privacy posture                       | More metric IDs and explicit user education                      |
| DG-10 | Both As-Was and Current-Reclassified, default As-Was                                                            | Reproducible issued reports plus strategic reclassification                              | Versioned rules and more complex semantic queries                |

## Post-approval contract closure outputs

Once the Business/Security Owner answers a gate, the next implementation run must convert the answer into the following governed artifacts before feature code is enabled:

| Gate  | Required approved contract outputs                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DG-01 | Segment code register; ownership/RACI; role-action matrix; import/DQ mapping; effective-date/history policy; DB/API/analytics delta                                   |
| DG-04 | State definitions; transition/actor/guard matrix; edit/freeze rules; approval/document/send mapping; ETag/idempotency/error contract; existing-data mapping           |
| DG-05 | Shipment aggregate/cardinality; reference ownership; milestone required-field matrix; permission/projection matrix; correction/evidence policy; DB/API/workflow delta |
| DG-07 | Provider/tenant decision; provisioning/binding lifecycle; multiplicity; MFA/session/recovery/revocation policy; audit/retention; DEP-001 evidence plan                |
| DG-08 | ALLOW/DENY field matrix; binding query invariant; list/detail/action DTOs; search/pagination; attachment/download/export; retention; IDOR/BFLA test matrix            |
| DG-09 | Metric IDs and definitions; canonical size/unit; date/basis/cohort; field projection; drilldown/export/audit/retention; Country Scope and Local/Global rules          |
| DG-10 | Effective date; rule versions; historical mode; snapshot/asOf contract; report geography-basis matrix; export metadata; golden/backfill plan                          |

## Implementation readiness summary

| Gate  | Status                              |
| ----- | ----------------------------------- |
| DG-01 | BUSINESS DECISION REQUIRED          |
| DG-04 | BUSINESS DECISION REQUIRED          |
| DG-05 | BUSINESS DECISION REQUIRED          |
| DG-07 | BUSINESS/SECURITY DECISION REQUIRED |
| DG-08 | BUSINESS DECISION REQUIRED          |
| DG-09 | BUSINESS DECISION REQUIRED          |
| DG-10 | BUSINESS DECISION REQUIRED          |

CR-001 implementation remains `PARTIAL / BLOCKED`.

Step 12 remains `NOT STARTED`.

Production Ready remains `NO`.

Release Gates remain `0 / 16 PASS`.
