# WS2-C Project Vertical Slice

Date: 2026-08-21  
Verdict: `WS2-C PROJECT VERTICAL SLICE = PASS`

## Contract correction

- Applied `docs/contracts/deltas/CD-WS2C-001.md` before implementation.
- Added the typed soft-archive command rather than stretching ordinary Project PATCH.
- Split Project list/detail DTOs, removed `normalizedName` from client projections, added server geography and required row version, and added typed Account/Country/Archive/Stage list filters.
- Project country is immutable through ordinary PATCH and is the direct Country Scope authority, independent of Customer HQ.

## Files created

- `docs/contracts/deltas/CD-WS2C-001.md`
- `docs/contracts/openapi/components/schemas/ProjectGeography.yaml`
- `docs/contracts/openapi/components/schemas/ProjectAccountReference.yaml`
- `docs/contracts/openapi/components/schemas/ProjectPartySummary.yaml`
- `docs/contracts/openapi/components/schemas/ProjectListItem.yaml`
- `docs/contracts/openapi/components/schemas/ProjectDetail.yaml`
- `docs/contracts/openapi/components/schemas/ArchiveProjectRequest.yaml`
- `docs/contracts/openapi/paths/projects_{projectId}_archive.yaml`
- `packages/database/prisma/migrations/20260821190000_ws2c_project_slice/migration.sql`
- `apps/api/src/customer/project.dto.ts`
- `apps/api/src/customer/project.controller.ts`
- `apps/api/src/customer/project.service.ts`
- `apps/api/src/project-proof-cli.ts`
- `apps/web/src/api/project-api.ts`
- `apps/web/src/app/ProjectPage.tsx`
- `docs/delivery/ws2-c-project-vertical-slice.md`

## Files modified

- `docs/contracts/openapi/openapi.yaml`
- `docs/contracts/openapi/paths/projects.yaml`
- `docs/contracts/openapi/paths/projects_{projectId}.yaml`
- `docs/contracts/openapi/components/schemas/ProjectEnvelope.yaml`
- `docs/contracts/openapi/components/schemas/Project.yaml`
- `docs/contracts/openapi/components/schemas/ProjectListEnvelope.yaml`
- `docs/contracts/openapi/components/schemas/CreateProjectRequest.yaml`
- `docs/contracts/openapi/components/schemas/UpdateProjectRequest.yaml`
- `docs/contracts/runtime-v1-operations.json`
- `docs/contracts/api-inventory.json`
- `docs/contracts/api-inventory.md`
- `docs/contracts/contract-evidence.json`
- `packages/api-client/src/generated/schema.ts`
- `packages/contracts/src/permissions.ts`
- `packages/database/prisma/schema.prisma`
- `apps/api/src/customer/customer.module.ts`
- `apps/api/src/customer/customer.integration.test.ts`
- `apps/api/src/openapi-contract-cli.ts`
- `apps/api/package.json`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/routes.ts`
- `apps/web/src/app/CustomerPage.tsx`
- `apps/web/src/app/CustomerPage.test.tsx`
- `package.json`
- `scripts/check-api-contract.mjs`

## Migration

- Migration `20260821190000_ws2c_project_slice` creates `projects`, `project_parties`, and the internal active-work reference guard.
- Enforced constraints include soft-archive shape, positive row version, one primary party per Project, party uniqueness, Country/User/Account foreign keys, and active/released work-reference state.
- PostgreSQL reports four migrations applied and the schema up to date.

## Runtime operations moved to IMPLEMENTED

1. `GET /projects`
2. `POST /projects`
3. `GET /projects/{projectId}`
4. `PATCH /projects/{projectId}`
5. `POST /projects/{projectId}/archive`

Total implemented runtime operations are now `22`.

## Authorization and business evidence

- Project Country Scope is applied in the PostgreSQL query before owner, configured direct manager, or Account-share context.
- Exact proof passed: an Egypt Customer is visible to an Egypt-only shared user while its Saudi Project returns `404`.
- Configured manager access and valid Account share context work only inside Project Country Scope.
- Explicit DENY wins.
- Logistics, Operations, and Finance workspaces receive no broad Project CRM access.
- Account filter/parent-path tampering cannot return a Project attached to a different Account.
- List filtering, search, sort, scope, and pagination are database-side.
- Project create/update/archive and party relationship are real PostgreSQL data.
- Project archive uses row locking, Serializable isolation, exact If-Match, idempotency, active-work validation, and structured audit. No hard delete exists.
- Concurrent update proof produces one success and one typed `412`.
- Customer 360 contains a real server-backed Projects section; Project list/detail/create/edit/archive use the generated client.

## Test and proof results

- Database package: `12 passed`, `0 failed`, `0 skipped`.
- Authorization package: `4 passed`, `0 failed`, `0 skipped`.
- Web package: `6 passed`, `0 failed`, `0 skipped`.
- API package: `5 passed`, `0 failed`, `0 skipped` against PostgreSQL for integration cases.
- Unique repository tests: `27 passed`, `0 failed`, `0 skipped`.
- Runtime OpenAPI: `22` implemented operations exercised through `24` response cases.
- `pnpm proof:project`: `PROJECT_SLICE_PROOF_PASSED` against the running NestJS application and PostgreSQL.
- Full `pnpm verify`: PASS, including status guard, format, lint, typecheck, tests, OpenAPI checks, generated drift, and production builds.

## Refreshed contract evidence

- OpenAPI operations: `173`
- Typed operations: `173`
- Implemented: `22`
- Contracted not implemented: `151`
- Out of scope V1: `21`
- Generic/placeholder/untyped schemas: `0`
- Generated artifact drift: `0`
- OpenAPI SHA-256: `282bc235ef76012f224f6bfe47798cf6d48780420445dd91b2316d5eeca9b701`
- Generated client SHA-256: `0f2e5536a88e1225c9d6245a7935aa26842d76e340d83b03d08c53025716e606`

## SSOT and governance

- SSOT deviations: `0`.
- No Formal Revisions, internal Sales Orders, capacity reservations, Shipment/POD, fake Project stage catalogue, or cross-workspace expansion was introduced.
- `implementationAuthorized = false`
- `productionReady = false`
- `RG-01 = EVIDENCE_GENERATED_AWAITING_SIGNOFF`
- `RG-02 = OPEN`
- Release Gates remain `0/16 PASS`.

The current PostgreSQL adapter still emits its previously recorded `pg@8` deprecation warning during test/proof execution. Expected business-conflict rollback is also logged by the generic transaction logger. Neither changes correctness or the PASS verdict; both remain platform-hardening cleanup before a future `pg@9` upgrade.
