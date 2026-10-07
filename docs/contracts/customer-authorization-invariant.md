# Customer authorization and projection invariant

This is the executable contract invariant approved by CD-WS2A-001. It aligns the API contract with the locked Country Scope, RBAC, sharing, and Sales-first SSOT; it does not introduce a new access model.

The server evaluates Customer access in this order:

1. active authenticated identity and session;
2. effective Country Scope;
3. RBAC and Sales workspace permission;
4. explicit effective DENY;
5. configured resource context: ownership, valid direct-manager relationship, explicit share, or another approved context;
6. field-level projection;
7. workflow and state rules.

Country Scope is an intersection boundary. Ownership, manager relationships, sharing, and contextual access can never add a country. An explicit DENY wins. A missing manager relationship grants nothing, and the contract does not fabricate a hierarchy.

Customer sharing remains the existing explicit resource mechanism. A valid share still requires active identity, country access, workspace permission, and no effective DENY. This delta adds no sharing workflow or route.

The backend is the projection authority. `AccountListItem` is the safe grid projection; `AccountDetail` is the safe Customer 360 base projection. Restricted/source metadata and unrelated workspace data are absent from both. Unauthorized properties are omitted through the selected schema/projection before serialization; React is not a field-security boundary.
