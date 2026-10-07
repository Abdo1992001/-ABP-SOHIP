# WS2-A Customer contract-defect blocker

## Status

`WS2-A CUSTOMER SLICE = UNBLOCKED FOR IMPLEMENTATION`

## Approved resolution

- Contract Delta: `CD-WS2A-001`
- Decision: `APPROVED`
- SSOT reopened: `NO`
- Business rule change: `NO`
- Contract correction: `YES`
- Contract/client version: `1.2.0`
- D9-001: `CLOSED — EVIDENCE REFRESHED`

CD-WS2A-001 corrected the executable contract and passed the full typed-contract gate. Customer runtime remains unimplemented and all Customer operations remain `CONTRACTED_NOT_IMPLEMENTED`. The detailed delta and evidence are in `docs/contracts/deltas/CD-WS2A-001.md`.

The sections below preserve the initial stop evidence that led to the approved delta.

The WS2-A task requires implementation against the existing authoritative OpenAPI and explicitly requires work to stop when a proven contract defect is found rather than silently changing the business contract. The defects below are observable contradictions or missing public contract capabilities required by the same task.

At the initial stop, no Customer runtime controller, database migration, frontend screen, OpenAPI implementation-status flag, or generated client was changed. The approved delta subsequently changed only the contract, generated client, inventories, and evidence.

## P0 defects

### CD-WS2A-001 — pagination authority contradicts itself

`GET /accounts` says `Cursor pagination` in its operation description, while the same operation exposes `page`, `offset`, `limit`, `sort`, and `search`, declares `x-abp-pagination: OFFSET`, and returns `OffsetPaginationMeta`.

WS2-A also explicitly locks Customer lists to offset pagination. Runtime behavior cannot safely choose between two advertised models without correcting the authority.

Recommended correction: retain the existing offset parameters/meta and replace the stale cursor sentence with an offset-pagination description.

### CD-WS2A-002 — clients cannot reliably acquire the required concurrency precondition

`PATCH /accounts/{accountId}` requires `If-Match`, but:

- `GET /accounts/{accountId}` does not define an `ETag` response header;
- `Account.rowVersion` exists but is not required by the `Account` schema;
- the update response defines `ETag`, creating an inconsistent first-update flow;
- archive uses `expectedRowVersion` in its body, while update uses `If-Match`, without guaranteeing that either token is returned by initial reads.

This prevents a generated-client-only UI from reliably performing its first safe update and makes the no-silent-overwrite requirement unprovable.

Recommended correction: make the representation token mandatory and return an `ETag` on Customer create/detail/update/archive. Keep the already contracted update/archive precondition styles unless the contract owner chooses one canonical style for both.

### CD-WS2A-003 — required Customer list filters are absent

The task requires deterministic filters and archived-record filter behavior. `GET /accounts` exposes only page/offset/limit/sort/search. It has no contracted status/archive, country, category, owner, or group filter.

Adding undocumented query parameters in the controller would violate OpenAPI authority and generated-client-only usage.

Recommended correction: define the approved Customer filter set, including the exact archive-status semantics, as typed OpenAPI query parameters before implementation.

### CD-WS2A-004 — Customer 360 classification required by the task is not present in the response

The `Account` DTO does not expose:

- continent;
- Local/Global/Unclassified geography classification;
- effective group/network memberships or mapping evidence;
- archive timestamp/actor;
- a typed geography object.

The physical SSOT defines effective-dated `account_group_memberships`, and WS2-A requires the governed WORCA → ACROW Global Network → Australia → Oceania → Global mapping to remain visible/auditable. The current Customer detail contract cannot represent that Customer-owned classification.

Recommended correction: approve a typed Customer-detail projection for geography and effective group membership. Do not add these fields to the list DTO unless explicitly required.

### CD-WS2A-005 — list and detail use the same unrestricted Account projection

Both `AccountListEnvelope` and `AccountEnvelope` return `Account`. That schema includes source/restricted fields such as `rawName`, `sourceSystemId`, and `sourceRecordKey`, while WS2-A requires list/detail separation where appropriate and field-level omission of restricted values.

No permission-to-field projection matrix exists in the public contract. Implementing a guessed projection would either violate the response contract or risk exposing restricted source data.

Recommended correction: approve distinct `AccountSummary` and `AccountDetail` projections, or explicitly approve which optional fields must be omitted for each stable permission/role.

### CD-WS2A-006 — generated-client-only country selector has no implemented reference source

The UI must use canonical country references and must not hardcode classification. There is no contracted country-reference list operation in the V1 surface. `GET /me` contains allowed country codes but is `CONTRACTED_NOT_IMPLEMENTED`, and implementing Identity as part of this task would violate the instruction to implement only the Customer slice.

Recommended correction: either authorize `GET /me` as an explicit WS2-A prerequisite plus approve how country labels are sourced, or approve an existing typed reference-data operation for active countries. Do not create an undocumented Customer-specific country endpoint.

### CD-WS2A-007 — field-level and record-policy decisions are not executable as written

The operation contract says `Country + owner/direct-manager/share`, and the physical authority requires the same intersection. However, the runtime contract does not define:

- the authenticated request/session adapter for this slice;
- the direct-manager source exposed to authorization;
- which share scope/access level allows view versus edit;
- the DENY/override representation;
- the permission rules for restricted Customer fields.

The current TypeScript permission catalog also lacks the already contracted stable codes `accounts.view`, `accounts.create`, `accounts.edit`, and `accounts.archive`. Adding those existing codes to code is mechanical, but inventing the missing policy semantics is not.

Recommended correction: approve the Customer authorization projection/matrix and authorize a non-production test-persona adapter for deterministic integration/E2E proof. Ownership/share must continue to intersect Country Scope.

## Authority update completed

CD-WS2A-001 resolved:

1. offset pagination wording and filter parameters;
2. guaranteed row-version/ETag acquisition;
3. Customer summary/detail and field-level projections;
4. geography/group projection;
5. canonical country reference source;
6. executable Customer record-policy matrix and test-auth prerequisite.

The TypeScript client was regenerated and `api:contract:check` passed with 172/172 typed operations, zero unresolved references/placeholders/duplicate operation IDs, and zero generated drift. The five intended Customer operations (list, create, detail, update, archive) may change to `IMPLEMENTED` only after their real runtime implementation and tests pass.

## Governance

- `implementationAuthorized`: unchanged (`false`)
- `productionReady`: unchanged (`false`)
- RG-01: unchanged, awaiting signoff
- RG-02: unchanged, open
- Release Gates: unchanged (`0/16 PASS`)
- D9-001: closed, evidence refreshed; this delta is not a regression to placeholders

## SSOT deviations

None. No implementation was guessed across the identified authority gaps.
