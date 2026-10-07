# CD-WS2B-001 — Contact response and share concurrency contract

## Classification

Contract correction required to implement the already-approved WS2-B Contact
scope. This delta adds no new business feature.

## Defects

1. Contact create accepts initial channels and channel commands return a
   Contact envelope, but the Contact response cannot represent channels.
2. Contact-only access must expose a minimal Account identity without granting
   Customer 360, but the response cannot represent that projection.
3. The same Contact DTO is used for list and detail, which would force channel
   and contextual detail into every list row.
4. Contact Share revocation requires `If-Match`, but the Contact Share response
   provides no row version from which a valid ETag can be obtained.
5. A Contact Share response does not identify the selected contact items.
6. The shared `CommandResult` incorrectly requires semantic analytics metadata
   for ordinary domain commands, which would force fabricated KPI provenance.

## Corrections

- Split `ContactListItem` and `ContactDetail`.
- `ContactDetail` includes typed `account` minimal identity and typed
  `channels`; it contains no Customer 360 or restricted source fields.
- `ContactListEnvelope` uses `ContactListItem`; `ContactEnvelope` uses
  `ContactDetail`.
- `ContactShare` includes required `contactIds` and required `rowVersion`.
- Contact Share creation returns the ETag represented by `rowVersion`; revoke
  requires that ETag and returns the normal typed command result.
- `CommandResult.analyticsMetadata` remains available only when a command is
  genuinely semantic; it is optional for ordinary mutation commands.
- Country Scope remains mandatory and is evaluated before Account or selected
  Contact share context. DENY continues to win.

## Evidence refresh

After the contract change: validate OpenAPI 3.1, regenerate the committed
TypeScript client, run drift and contract tests, refresh inventory/report/hash
evidence, and keep RG-02 OPEN.

## Verdict

`CD-WS2B-001 = APPROVED EXECUTION CORRECTION`
