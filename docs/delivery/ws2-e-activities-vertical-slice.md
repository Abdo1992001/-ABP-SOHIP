# WS2-E — Activities vertical slice

## Current verdict

**PARTIAL — implementation evidence is strong, but browser E2E proof is not
yet available in this repository.** This document intentionally does not
upgrade the slice to PASS.

## Delivered surface

- PostgreSQL Activities, links, history and reminders schema, including the
  contract fields `occurredAt`, `scheduledAt` and `outcomeCode`.
- Typed Sales-only APIs for list/create/detail/edit/complete/reschedule/cancel.
- Server-side Country Scope first, then inherited account context; workspace
  permission and explicit deny are still enforced by the standard policy.
- `If-Match` row-version protection for ordinary update and cancel; typed
  expected row-version for complete and reschedule.
- Durable idempotency for create, complete, reschedule and cancel; audit for
  every state-changing operation. Cancelling clears active reminders in the
  same transaction.
- Sales Activities UI uses only the generated OpenAPI client for create,
  edit, reschedule, complete and cancel. It never computes access, lifecycle,
  country, or concurrency authority.

## Verification evidence

| Check                                                    | Result                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PostgreSQL migration deploy/status                       | PASS — 9 migrations applied                                                       |
| PostgreSQL API integration suite                         | PASS — activity persistence, Country Scope, ETag race, audit and workspace denial |
| `proof:activity` against PostgreSQL                      | PASS — `ACTIVITY_SLICE_PROOF_PASSED`                                              |
| Web typecheck / unit tests / lint                        | PASS                                                                              |
| OpenAPI lint / generated client / runtime contract check | PASS                                                                              |
| Browser E2E customer proof                               | NOT YET AVAILABLE — blocker to final WS2-E PASS                                   |
| SSOT deviations                                          | 0                                                                                 |

## Contract evidence refresh

- OpenAPI SHA-256: `06e1c5a8561dfccca37c095a92822853656f320fad77ce839ccd59d2108f7666`
- Generated client SHA-256: `a778a071cfc2d1a17a74ffa85392ea5159a0621d3bd252266fe1ca3f4e8e5bf3`
- Typed operations: 177; implemented operations: 37.

## Governance unchanged

`implementationAuthorized=false`; `productionReady=false`; RG-01 remains
`EVIDENCE_GENERATED_AWAITING_SIGNOFF`; RG-02 remains OPEN; release gates remain
`0/16`.
