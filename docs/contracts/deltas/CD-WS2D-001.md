# CD-WS2D-001 — Opportunity pipeline contract corrections

Status: **APPROVED EXECUTION CORRECTION**

1. Pipeline stages and their default probability are governed, effective-dated server configuration. The service has no fixed production probability values and no ML authority.
2. Lost reasons are a governed effective-dated lookup. No production reason catalogue is fabricated; an approved source must populate it. The typed lookup surface can return no active values until that dependency is supplied.
3. List and detail are separate safe DTOs. Detail returns `rowVersion`, probability provenance, stage transition history, and immutable WON snapshot history; list omits restricted history.
4. Ordinary PATCH cannot manually set probability. A typed probability-override command requires `opportunities.probability.override`, reason, source metadata, ETag, idempotency, history, and audit.
5. Stage transition requires `If-Match` (not a body duplicate), idempotency, and server policy validation. LOST requires an active governed reason. WON requires estimated value and currency, persists an immutable snapshot, and contributes only through the WON fact. Reopening WON creates a reversal history event; no history is silently rewritten.
6. If a Project is supplied it must be active and explicitly related to the Account. Opportunity effective Country is Project country when Project exists, otherwise Account country. Creation requires Country Scope for every protected source; reads apply effective Opportunity Country before Account context.
7. A null Project requires a nonblank no-project reason. A linked Project forbids a no-project reason.

RG-02 remains OPEN. Governance flags and Release Gates are unchanged.
