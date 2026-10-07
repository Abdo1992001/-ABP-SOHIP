# ABP Codex execution pack v1.1 overlay

This overlay corrects `ABP_Codex_Full_Prompt_Pack_After_WS2B.txt`. It is an
execution control document, not a new business feature source. Where the base
pack and this overlay differ, this overlay wins. The unsigned Baseline R1 and
the authoritative Step workbooks remain unchanged.

## Authority and governance

- Use the Baseline R1 source registry and only its authoritative Step files.
- Quarantined or conflicting branches must never be selected because their
  filename or version number is higher.
- OpenAPI 3.1 remains the transport-contract authority. A contract defect must
  be closed through an explicit Contract Delta and refreshed evidence before
  implementing the affected operation.
- Do not change `implementationAuthorized`, `productionReady`, RG-01, RG-02,
  or the Release Gate total as a side effect of a vertical slice.
- Every slice requires real PostgreSQL integration, generated-client use,
  authorization, audit, concurrency where contracted, UI, E2E proof, and zero
  SSOT deviations.

## Entry precondition

The base pack may start at WS2-C only after WS2-B Contacts has a PASS report,
real PostgreSQL proof, generated-client proof, and runtime operations marked
`IMPLEMENTED`. A title saying "After WS2-B" is not evidence.

Current execution therefore starts with WS2-B.

## Required contract deltas

### CD-WS2C-001 — Project archive

Before WS2-C, add a typed soft-archive command with permission, Country Scope,
record-context authorization, ETag/row-version concurrency, active-work
validation, audit, idempotency, and no hard delete. `PATCH /projects/{id}` must
not be stretched silently to perform an uncontracted lifecycle command.

### CD-WS2E-001 — Activity cancel

Before WS2-E, add a typed cancel command with reason, permission, inherited
protected-context scope, ETag/row-version concurrency, idempotency, audit, and
reminder cancellation. Ordinary activity PATCH must not silently mutate the
task lifecycle.

## Corrected WS2 scope

WS2 cannot pass until the contracted Customer governance functions are either
implemented or explicitly reported as blocked by an approved dependency:

- customer share/list/revoke and contact sharing;
- ownership transfer;
- duplicate check and governed merge preview/execute;
- auditable effective group/network membership where its owning slice applies.

Add a Customer Governance slice before the final Sales Core Integration pass.

## Opportunity correction

- Lost reasons are a configurable, governed lookup. Do not fabricate a
  production seed list. Load only an approved seed/source; otherwise implement
  the typed lookup mechanism and report the seed dependency.
- Probability uses the governed stage default. An authorized manual override
  requires a reason, source metadata, history, and audit. No ML authority.

## Pricing correction

- Tax is resolved from an effective-dated/versioned Tax Policy and snapshotted
  on the quotation. Fourteen percent is an initial configured policy only when
  approved/current; it is not a code constant.
- The initial five-percent approval threshold and seven-day validity are also
  versioned configuration, never hardcoded engine constants.

## Corrected WS5 scope

- Payments and Cheques are V1 business scope, not optional features. They must
  not be enabled without typed contracts, explicit permissions, trusted source
  data, and UAT. A missing dependency produces BLOCKED/PARTIAL, not silent
  omission.
- Add a Complaints vertical slice. It includes typed CRUD/status commands,
  Country/customer/case scope, case-only ownership, history/audit, and
  `complaint.close`/Manager authority. Creating a complaint never broadens
  Customer access.
- WS5 cannot pass until both Returned Scrap and Complaints pass.
- Returned Scrap must implement the governed state machine, submit assessment
  hash, invalidation after material edits, eligibility ledger, and serialized
  submit/finalize checks that prevent concurrent double claims. No-partial is
  enforced in the ledger/service, not only in the UI.

## D10-BI closure correction

Typed metric/report contracts must include, where applicable:

- metric ID, version, owner, status and effective dates;
- business definition, numerator/denominator and inclusion/exclusion rules;
- date, currency and geography basis;
- source lineage, as-of, freshness/staleness and raw-vs-clean reconciliation;
- scope, privacy classification and permissioned drilldown fact;
- unit, precision/rounding and null/zero policy;
- typed filters/dimensions and a QA reconciliation contract.

The server remains KPI authority. D10-BI closes only after validation,
generated-client drift checks, contract tests, semantic reconciliation evidence,
and zero placeholders. RG-03 remains open until its separate governed evidence.

## Corrected execution order

1. WS2-B Contacts prerequisite.
2. CD-WS2C-001, then WS2-C.
3. Corrected WS2-D.
4. CD-WS2E-001, then WS2-E.
5. Customer Governance slice.
6. Sales Core Integration.
7. Continue the base pack with the pricing, WS5, and D10 corrections above.

Every task stops after its verdict and never starts the next task automatically
unless the user explicitly continues execution.
