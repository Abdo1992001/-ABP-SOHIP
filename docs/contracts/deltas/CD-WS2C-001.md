# CD-WS2C-001 — Project contract corrections

Status: **APPROVED EXECUTION CORRECTION**  
Authority: locked Project/Country Scope decisions plus the WS2-C execution gate.  
Nature: contract repair; no new business feature.

## Corrected decisions

1. Project archive is a separate typed soft-archive command. It requires `projects.archive`, exact `If-Match`, an idempotency key, a reason, active-work validation, structured audit, and never hard-deletes.
2. Project GET/create/update/archive return `ETag`; Project detail contains required `rowVersion`.
3. List and detail projections are separate. `normalizedName` is server-internal and is not returned.
4. Project geography is server truth and is independent of Customer HQ: Country, Continent, and Local/Global are returned by the backend. React does not derive them.
5. Project list accepts typed Account, Country, Archive State, and Stage filters so Customer 360 and Project grids do not filter authorization results in memory.
6. Project detail returns an authorized party summary. The primary Customer/Account relation is explicit and auditable.
7. Country Scope is evaluated from `project.country_code` before owner, manager, Customer share, or party context. No contextual mechanism widens Country Scope; explicit DENY wins.
8. Project country is immutable through ordinary PATCH. Moving a Project between countries is not silently invented as an update operation.

## Governance

- OpenAPI remains authority and generated-client evidence must be refreshed.
- `RG-02` remains open.
- `implementationAuthorized`, `productionReady`, `RG-01`, and Release Gate totals are unchanged.
