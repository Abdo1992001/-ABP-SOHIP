# Contract Delta CD-S9-001

Status: `APPROVED — IMPLEMENTED — VERIFIED`

Approval is strictly additive. It closes six missing authoritative projections required by the locked V1 UI. It does not add a business domain or change quotation, ERP-order, capacity, logistics, Finance, analytics, Country Scope, DENY, audit, or authorization semantics.

## Reason and affected screens

| Gap                    | Screens                                   | Added authority                                     |
| ---------------------- | ----------------------------------------- | --------------------------------------------------- |
| Durable job lookup     | Quotation PDF, Import, Export, Job Status | Safe `GET /jobs/{jobId}` projection                 |
| Template lifecycle     | Template Administration                   | Draft/version/edit/activate/archive/history/preview |
| Payment detail         | Payment Detail                            | Finance-only detail projection, separate from list  |
| Document list/history  | Document Center                           | Authorized list and persisted version provenance    |
| Global DQ queue        | ERP DQ                                    | Governed, scoped unresolved-issue queue             |
| Reconciliation history | Reconciliation                            | Existing ERP/data reconciliation run history        |

## Added operations

Fourteen operations were added in OpenAPI 1.3.0: one job lookup, eight template operations, one Payment Detail operation, two Document Center operations, one global DQ list, and one reconciliation list. All fourteen are `IMPLEMENTED`; mandatory runtime operations are now 191/191. The previous 1.2.0 contract evidence remains in `docs/contracts/history/openapi-1.2.0-evidence.json`.

## Typed contracts

Requests use the specific template create/version/update/transition schemas. Responses use `JobStatusEnvelope`, template/version/preview envelopes, `PaymentDetailEnvelope`, `DocumentListEnvelope`, `DocumentVersionListEnvelope`, `DataQualityIssueListEnvelope`, and `ReconciliationRunListEnvelope`. Errors use canonical typed responses; there are no unresolved references, generic objects, placeholder schemas, or duplicate operation IDs.

## Security and projections

- Job lookup requires source permission and resource/owner context; payloads, stack traces, secrets, and internal failure metadata are omitted.
- Template permissions are explicit. Active and archived versions are immutable; draft mutation uses `If-Match`.
- Payment list remains restricted; Payment Detail is Finance-only and returns source, allocations, and correction history only in the authorized projection.
- Document list/version/download authorization applies Country Scope and target-resource access. Storage keys and raw paths are not public download URLs.
- Global DQ is permissioned and Country Scope constrained. Resolution preserves source lineage, reviewer, timestamp, and audit.
- Reconciliation history is ERP/data reconciliation only and adds no accounting semantics.
- DENY remains final; Country Scope is evaluated before ownership/share/manager visibility.

## Pagination, concurrency, idempotency, and audit

Lists use stable server-side offset pagination and typed filters. Mutable template drafts require `If-Match`; activation/archive are immutable transitions. Create/version/transition commands require governed idempotency keys. Template changes, DQ decisions, and document provenance write structured audit records transactionally.

## Evidence

- OpenAPI version: `1.3.0`
- OpenAPI SHA-256: `ee4b858e6755b84746437aaf1733405ebc5edc14b00ab28f3d988499f19833b1`
- Generated client: `@abp/api-client@1.3.0`
- Generated client SHA-256: `4aa123fb7305d061929d7e1c394787f51a2afe6bbe146e31568bc8612933b4b7`
- Generated client drift: `0`
- PostgreSQL proof: `CD_S9_001 PASS`
- Job IDOR, Finance projection, Country Scope, and immutable template history: `PASS`

No prior evidence was overwritten or represented as if 1.3.0 had always existed.
