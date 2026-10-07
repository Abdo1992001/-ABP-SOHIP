# CD-WS2A-001 — Customer contract corrections

## Decision

- Contract Delta: `CD-WS2A-001`
- Decision: `APPROVED`
- SSOT reopened: `NO`
- Business rule change: `NO`
- Contract correction: `YES`
- Customer runtime implemented by this delta: `NO`

## Defect and authoritative rule

The prior executable contract contradicted or omitted already-locked Customer rules: it mixed cursor wording with offset parameters, did not guarantee an initial concurrency token, lacked required grid filters, reused one source-bearing Account projection for list/detail, could not represent server-authoritative geography/group classification, and had no typed country-reference source for the frontend.

The approved authority is now represented as follows:

- Customer grids use offset pagination; cursor remains for approved append-only feeds.
- Customer detail and successful mutations expose identical strong ETag/rowVersion values encoded as `"rv-N"`; update and archive require that exact value in `If-Match`; stale values use typed 412.
- Customer lists have typed archive (`ACTIVE`, `ARCHIVED`, `ALL`), canonical country-code, and existing category-code filters, plus a stable whitelisted sort with `accountId` as server tie-breaker.
- `AccountListItem` and `AccountDetail` are separate safe projections.
- `AccountDetail` carries server-authoritative country, canonical continent, `LOCAL/GLOBAL/UNCLASSIFIED`, effective group membership, archive state, and required rowVersion.
- source lineage, raw/normalized source names, Finance-sensitive values, and unrelated workspace internals are absent from default Customer responses.
- `GET /reference/countries` is the single typed platform-reference contract for country selection. It remains contracted, not implemented.
- authorization order and invariants are machine-readable in OpenAPI and documented in `customer-authorization-invariant.md`.

## Affected operations

- `GET /accounts`
- `POST /accounts`
- `GET /accounts/{accountId}`
- `PATCH /accounts/{accountId}`
- `POST /accounts/{accountId}/archive`
- existing Customer mutations that return the safe detail projection
- new approved contract: `GET /reference/countries`

All Customer and Reference Countries operations remain `CONTRACTED_NOT_IMPLEMENTED`; no runtime route was exposed.

## Affected schemas and parameters

Added projections/types include `AccountListItem`, `AccountDetail`, `AccountGeography`, `CountryReference`, `ContinentCode`, `MarketScope`, `EffectiveGroupMembershipSummary`, and `CountryReferenceListEnvelope`. Customer-specific archive/country/category/sort parameters were added. Restricted source inputs were removed from public create/update requests. Archive concurrency moved from body `expectedRowVersion` to `If-Match`.

## Compatibility analysis

This is a generated-client breaking correction because Account response shapes, archive precondition placement, and Customer list query types change. It is carried as contract/client `1.2.0` on the established `1.x` pre-runtime contract line. The affected business endpoints were not implemented, so no supported runtime consumer is broken. The change is not a business feature or SSOT reopening.

## Generated-client impact

- Previous: `@abp/api-client@1.1.0`
- Current: `@abp/api-client@1.2.0`
- deterministic generated output: required and committed
- manual generated-code edits: none

## Evidence hashes

The previous evidence is preserved in `docs/contracts/evidence/d9-001-contract-1.1.0-superseded.json`.

- Previous OpenAPI SHA-256: `0785cb995d5b316fd370c80b8bbb138cd3519cf6d684489cfd2f602ffb84e19d` — superseded
- Previous generated client SHA-256: `ae24b157da00bd677954e46d38411590f49af5b74cb07b9b8dd1f4bf0742cf2e` — superseded
- Current OpenAPI SHA-256 after WS2-A runtime enablement: `9d898a4d17eadc65430c865c7667ab47fc6ce19dbe3804fa38abfb64b32d98f1`
- Current generated client SHA-256 after WS2-A runtime enablement: `8b922a28f7a24995f78376edff268793bb4d86f1c34d68ad8593371b86b52165`

## Verification evidence

The root `corepack pnpm verify` gate passed after the evidence refresh. It covered status guard, formatting, ESLint, TypeScript, repository tests, contract validation, generated-client drift, API-client build, API contract tests, and API/Web/Worker builds.

Final closure counts:

- OpenAPI operations: 172
- typed operations: 172/172
- implemented runtime operations: 2
- contracted-not-implemented operations: 170
- out-of-scope inventory operations: 21
- unresolved references: 0
- `GenericObject`: 0
- forbidden placeholders: 0
- duplicate operation IDs: 0
- generated-client drift: 0

Repository unit result: 8 passed. The 11 PostgreSQL WS0 integration tests remained skipped because no test database was configured; this contract-only delta neither claims nor needs Customer database/runtime coverage. Runtime contract proof remained 4/4 response cases for the two genuinely implemented Health operations. No Customer or Reference Countries endpoint was faked for test coverage.

## Governance

The statements above that Customer runtime was not implemented describe the scope and moment of the contract-only delta. WS2-A subsequently implemented and evidence-tested the five Customer operations plus `GET /reference/countries` and the required `GET /me` auth context without changing the approved contract surface.

RG-02 remains open. Implementation authorization, Production readiness, RG-01, and Release Gate totals are unchanged.
