# WS2-B Contact Vertical Slice Evidence

Date: 2026-08-21  
Verdict: `WS2-B CUSTOMER VERTICAL SLICE = PASS`

## Authority and scope

- The corrected execution overlay is `ABP-CODEX-EXECUTION-PACK-v1.1-OVERLAY.md`.
- The contract correction authority is `CD-WS2B-001.md`.
- Contacts are subordinate to the real Account aggregate and do not create a second Customer truth.
- Contact-only sharing exposes selected Contacts plus minimal Account identity. It does not grant Customer 360, Projects, Opportunities, Quotations, or ERP history.
- No Contact delete operation was added. No fake lifecycle, notification, or merge capability was introduced.

## Implemented proof surface

- PostgreSQL tables: `contacts`, `contact_channels`, `contact_shares`, and `contact_share_items`.
- PostgreSQL constraints include Account ownership of selected share items and one primary channel per Contact/channel type.
- Typed runtime operations: list/create/get/update Contact, add/remove channel, create/revoke selected Contact share.
- Every operation uses the generated `@abp/api-client` contract.
- Backend authorization enforces permission, explicit DENY, Country Scope, parent Account context, and selected-contact share scope.
- Contact and Contact Share mutations append structured audit events inside the transaction boundary.
- Contact list and detail use distinct projections; normalized channel values are not returned or written into audit snapshots.
- The Sales Customer 360 contains the Account Contact section; a direct Contact route supports the restricted contact-only projection.

## Executable evidence

| Gate                   | Result | Evidence                                                                                                        |
| ---------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| PostgreSQL migrations  | PASS   | Three migrations deployed; `prisma migrate status` reports schema up to date.                                   |
| PostgreSQL integration | PASS   | API integration suite passed against PostgreSQL 17.                                                             |
| Country Scope          | PASS   | Account/Contact access and share-recipient eligibility are intersected with server-side Country Scope.          |
| ETag / If-Match race   | PASS   | Concurrent writes produce one success and one `412 CONCURRENCY_CONFLICT`; stale proof write rejected.           |
| Audit                  | PASS   | Contact create/update/channel and share create/revoke events verified; no `normalizedValue` leakage.            |
| Contact-only sharing   | PASS   | Recipient sees only the selected Contact and minimal Account identity; Customer 360 remains denied.             |
| Cross-workspace denial | PASS   | Logistics, Operations, and Finance personas cannot open the Contact surface.                                    |
| Explicit DENY          | PASS   | DENY overrides base permission and contextual visibility.                                                       |
| Frontend               | PASS   | Contact UI and restricted direct projection tests passed; generated client only.                                |
| `proof:contact`        | PASS   | `CONTACT_SLICE_PROOF_PASSED` against the running NestJS app and PostgreSQL.                                     |
| OpenAPI / drift        | PASS   | 172/172 typed; 17 implemented; zero generated artifact drift; Redocly valid.                                    |
| Runtime contract       | PASS   | All 17 implemented operations exercised; 19 response cases passed.                                              |
| Full repository verify | PASS   | Format, lint, typecheck, tests, contract checks, and production builds passed.                                  |
| SSOT deviations        | 0      | No Formal Revisions, internal Sales Orders, reservation, Shipment/POD, or cross-workspace expansion introduced. |

## Refreshed contract evidence

- OpenAPI operations: `172`
- Typed operations: `172`
- Implemented operations: `17`
- Contracted but not implemented: `155`
- Out of scope operations: `21`
- OpenAPI SHA-256: `b9b30d28da102447055606b4566c275e3bc6a075abf2a64d334ec73e1204dd2f`
- Generated client SHA-256: `5aaf6a25d3787c9737c531fe5c17592e5f6109806736fd9043b9fecae62d5a08`

## Governance remains unchanged

- `implementationAuthorized = false`
- `productionReady = false`
- `RG-01 = EVIDENCE_GENERATED_AWAITING_SIGNOFF`
- `RG-02 = OPEN`
- Release Gates = `0/16 PASS`

The PostgreSQL `pg` adapter emits a deprecation warning about concurrent `client.query()` use during the test/proof process. It did not affect correctness or test outcomes, but it should be removed in a later platform-hardening task before upgrading to `pg@9`.
