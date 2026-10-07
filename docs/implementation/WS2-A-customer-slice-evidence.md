# WS2-A Customer vertical slice evidence

## Scope

WS2-A implements the real Customer slice only: PostgreSQL persistence and migrations, Customer API, `/me`, reference countries, Country Scope/record-context authorization, strong ETag concurrency, transactional audit, Sales-first Customer UI, generated-client integration, and deterministic tests/proof. Contacts and all other future modules remain outside this slice.

## Runtime operations

- `GET /me`
- `GET /reference/countries`
- `GET /accounts`
- `POST /accounts`
- `GET /accounts/{accountId}`
- `PATCH /accounts/{accountId}`
- `POST /accounts/{accountId}/archive`

The Customer list uses offset pagination. Country Scope is applied server-side before owner, configured direct-manager, or explicit-share context. Explicit DENY wins. Restricted/source fields are omitted by explicit list/detail projection. The UI obtains country options from the typed Reference Countries API and never derives continent or Local/Global authority.

## Executable evidence

- Clean PostgreSQL 17 migrations: two migrations applied and schema status current.
- PostgreSQL integration suite: real API application and real database; covers authentication, Country Scope, configured manager context, share intersection, explicit DENY, Logistics/Operations/Finance denial, safe projections, WORCA mapping, generated rowVersion/ETag, concurrent stale-write rejection, archive filtering, no DELETE route, idempotency, and create/update/archive audit.
- Frontend RTL suite: generated-client calls, Customer 360 server truth, governed country selector, permission-gated navigation/actions, and typed 412 user feedback.
- `corepack pnpm proof:customer`: starts the built Nest runtime, drives it through `@abp/api-client` over HTTP, checks create/read/update/stale/list/out-of-scope/archive, verifies audit records, and emits `CUSTOMER_SLICE_PROOF_PASSED` only on success.
- Contract evidence: 172/172 operations typed, 9 runtime-enabled, 163 contracted-not-implemented, 21 explicitly out of V1, and deterministic generated-client drift zero.

## Current contract hashes

- OpenAPI: `9d898a4d17eadc65430c865c7667ab47fc6ce19dbe3804fa38abfb64b32d98f1`
- Generated client: `8b922a28f7a24995f78376edff268793bb4d86f1c34d68ad8593371b86b52165`
- Package: `@abp/api-client@1.2.0`

## Governance invariants

This slice does not change `implementationAuthorized`, `productionReady`, RG-01, RG-02, or the Release Gate total. RG-02 remains open pending its governed evidence/signoff process.

## Final gate result

- `corepack pnpm verify`: PASS with PostgreSQL integration enabled.
- Database tests: 12/12 PASS.
- API tests: 3/3 PASS.
- Frontend tests: 4/4 PASS.
- Authorization tests: 4/4 PASS.
- Runtime OpenAPI cases: 11/11 PASS.
- `corepack pnpm proof:customer`: `CUSTOMER_SLICE_PROOF_PASSED`.
- Prisma database-to-datamodel drift: `No difference detected`.
- SSOT deviations: 0.
