# WS2-D — Opportunity & Pipeline vertical slice

## Verdict

**PASS** — the Opportunity/Pipeline slice is implemented as a real, bounded
Sales-core vertical slice. No later slice was started.

## Contract and SSOT alignment

- `CD-WS2D-001` is implemented before the slice, rather than adapting the
  contract to match code.
- Pipeline stages and default probability are read from effective-dated server
  policy. The application ships no production stage/probability seed data and
  contains no ML authority.
- Lost reasons are an effective-dated, typed, server lookup. The proof and
  integration suite create clearly scoped test fixtures only.
- Opportunities use safe list and detail DTOs. Detail returns strong ETag/
  `rowVersion`, transition history, probability provenance and WON snapshots;
  the list does not expose that detail projection.
- `PATCH` cannot change probability. The separate override command requires
  permission, ETag, idempotency key, reason, source metadata, persisted history
  and audit.
- `WON` requires value and currency and persists an immutable snapshot.
  Reopening creates a `WON_REVERSED` history event; it does not rewrite history.
- Effective opportunity country is Project country where a Project is linked,
  otherwise Account country. Country Scope is applied before account context;
  DENY remains terminal.

## Delivered surface

- PostgreSQL schema and migrations for Opportunities, stage policies, lost
  reasons, stage transitions, probability override history and WON snapshots.
- Eight real API operations: list/create/get/update, stage transition,
  probability override, stage-policy lookup and lost-reason lookup.
- Sales Pipeline React route and detail view using only the generated API
  client. Stages and lost reasons come from the typed Reference APIs; React
  does not calculate authoritative probability or geography.
- Transactional audit events for creation, update, probability override and
  stage transitions.
- Executable `proof:opportunity` against PostgreSQL.

## Verification evidence

| Check                                                    | Result         |
| -------------------------------------------------------- | -------------- |
| PostgreSQL migrations (6 applied)                        | PASS           |
| PostgreSQL API integration suite                         | PASS — 6 tests |
| Country Scope and cross-workspace denial                 | PASS           |
| Explicit DENY                                            | PASS           |
| ETag/If-Match stale mutation rejection                   | PASS           |
| WON snapshot and reversal history                        | PASS           |
| Audit                                                    | PASS           |
| `proof:opportunity`                                      | PASS           |
| Web tests                                                | PASS — 6 tests |
| OpenAPI lint / generated-client drift / runtime contract | PASS           |
| Formatting, lint and workspace typecheck                 | PASS           |
| SSOT deviations                                          | 0              |

OpenAPI evidence refresh:

- OpenAPI SHA-256:
  `5ed1ccbf91b05a8a475d08abbafbb870bc74e530c016373c3be0dbdc00c4c060`
- Generated client SHA-256:
  `c337e6be44d3ed083d6b7c2e8a42b3fc37197d7de83db3e3f42a94be989beb0e`
- Contract operations: 176 typed / 30 implemented / 146 contracted but not
  implemented.

## Governance remains unchanged

`implementationAuthorized=false`; `productionReady=false`; RG-01 remains
`EVIDENCE_GENERATED_AWAITING_SIGNOFF`; RG-02 remains OPEN; Release Gates remain
`0/16`.
