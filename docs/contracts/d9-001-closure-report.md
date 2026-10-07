# D9-001 typed OpenAPI closure report

## Verdict

`D9-001 = PASS — IMPLEMENTATION BLOCKER CLOSED; CD-WS2A-001 EVIDENCE REFRESHED`

This closes the typed-OpenAPI implementation blocker only. It does not approve RG-02, change RG-01, authorize implementation, or declare the system Production Ready.

## Authority and scope reconciliation

- Contract authority: OpenAPI 3.1.0 at `docs/contracts/openapi/openapi.yaml`.
- API contract version: `1.2.0`.
- Operation authority: the 171 V1 operations in `ABP_Step7_Backend_Architecture_API_Contract_LOCKED_v1_1.xlsx`, sheet `11_Final_API_Catalog`, plus the approved minimal Platform Reference Countries contract in CD-WS2A-001.
- A later typed draft was used only as schema source material. The importer filters it to the exact locked v1.1 method/path set; its 14 extra operations are not carried into this contract.
- Runtime exposure is limited to the nine operations in `runtime-v1-operations.json`: two Health operations plus the seven WS2-A Customer/auth/reference prerequisites. The other 163 future operations are explicitly `CONTRACTED_NOT_IMPLEMENTED` and are not mounted as runtime controllers.
- Twenty-one prohibited or intentionally excluded operations are recorded separately in `out-of-scope-v1.yaml`.

The contract preserves the locked V1 foundation: no formal quotation revisions; ERP Sales Orders are imported read-only facts; capacity is estimate-only at Standard 900, Ordinary 700, Curved 600 boards/day and 24 hours/day; no reservations/MES; Logistics is Flat-on-Face planning only; no Shipment/POD execution; Country Scope is mandatory; Returned Scrap uses original purchase unit price and the locked 25% rule; AI remains advisory.

## Closure evidence

| Measure                                      |         Result |
| -------------------------------------------- | -------------: |
| Total inventoried operations                 |            193 |
| OpenAPI V1 operations                        |            172 |
| Implemented/runtime-enabled                  |              9 |
| Contracted, not implemented/runtime-disabled |            163 |
| Explicitly out of V1                         |             21 |
| Enabled/planned V1 operations typed          | 172/172 (100%) |
| Unresolved references                        |              0 |
| Duplicate `operationId` values               |              0 |
| `GenericObject` occurrences                  |              0 |
| Forbidden placeholder occurrences            |              0 |
| `additionalProperties: true` occurrences     |              0 |
| Untyped/empty object schemas                 |              0 |
| Generated-client drift                       |              0 |
| Runtime contract cases                       |     11/11 PASS |

Canonical artifact hashes:

- Bundled OpenAPI SHA-256: `9d898a4d17eadc65430c865c7667ab47fc6ce19dbe3804fa38abfb64b32d98f1`
- Generated TypeScript schema SHA-256: `8b922a28f7a24995f78376edff268793bb4d86f1c34d68ad8593371b86b52165`
- Generated client package: `@abp/api-client@1.2.0`

The previous `1.1.0` hashes remain immutable historical evidence in `docs/contracts/evidence/d9-001-contract-1.1.0-superseded.json` and are marked `SUPERSEDED BY APPROVED CONTRACT DELTA CD-WS2A-001`; they are not current evidence.

The committed machine-readable evidence is `contract-evidence.json`. The human and machine inventories are `api-inventory.md` and `api-inventory.json`.

## Runtime contract proof

The runtime contract test starts the real Nest application module with only the PostgreSQL readiness dependency replaced by a deterministic test adapter. It proves:

- `GET /api/v1/health/live` returns the typed `HealthEnvelope` and does not query PostgreSQL.
- `GET /api/v1/health/ready` returns the typed 200 `HealthEnvelope` after a successful dependency query.
- failed readiness returns the documented typed 503 `HealthEnvelope`.
- an unknown route returns the canonical typed `ErrorEnvelope`, preserves safe trace/correlation identifiers, and does not leak the route or infrastructure details.
- all seven WS2-A runtime routes are mounted and return the typed unauthenticated envelope when no session is present.

Customer success responses are validated separately against real PostgreSQL by the WS2-A integration suite and executable generated-client proof; no business-domain endpoint is faked to increase coverage.

## Deterministic gates

`corepack pnpm api:contract:check` is the single contract gate. It performs:

1. external-reference bundling and validation;
2. operation count, typing, status, runtime-manifest, and operation-ID checks;
3. zero-placeholder, zero-`GenericObject`, constrained-object, common-type, durable-job-state, and out-of-scope scans;
4. deterministic regeneration/drift verification;
5. Redocly OpenAPI lint;
6. generated API-client compilation;
7. API unit tests;
8. runtime OpenAPI contract tests.

The root `verify` command includes this gate, so the GitHub Actions verification workflow fails on contract or generated-client drift.

## Final verification

| Command/check                               | Result                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `corepack pnpm format:check`                | PASS                                                          |
| `corepack pnpm lint`                        | PASS, 0 findings                                              |
| `corepack pnpm typecheck`                   | PASS, 7 workspace projects                                    |
| OpenAPI lint                                | PASS                                                          |
| OpenAPI bundle/schema validation            | PASS                                                          |
| zero-placeholder scan                       | PASS                                                          |
| deterministic generated-client regeneration | PASS                                                          |
| generated-client drift check                | PASS, drift 0                                                 |
| API-client build                            | PASS                                                          |
| API tests                                   | PASS, 3/3 including real PostgreSQL Customer integration      |
| runtime contract tests                      | PASS, 11/11 response cases across 9 operations                |
| repository tests                            | PASS, 23/23 across database, API, authorization, and frontend |
| API build                                   | PASS                                                          |
| Web build                                   | PASS, including import of `@abp/api-client`                   |
| Worker build                                | PASS                                                          |

The final WS2-A verification configured PostgreSQL 17 and ran all 12 database tests plus the Customer API integration test without skips. D9 runtime response validation still uses only a narrow readiness adapter; Customer success behavior is covered by the separate real-database suite and `proof:customer`.

## Governance after closure

- D9-001 implementation blocker: `CLOSED`.
- RG-02: `OPEN`; release-gate evidence verification/signoff is separate.
- RG-01: unchanged, awaiting signoff.
- `implementationAuthorized`: unchanged (`false`).
- `productionReady`: unchanged (`false`).
- Release Gates: unchanged (`0/16 PASS`).
