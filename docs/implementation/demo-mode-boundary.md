# Demo / staging mode boundary

Status: `NON-AUTHORITATIVE`

This mode is explicitly for demonstrating the workflows while approved static
data, template files, ERP import runs, Entra identities and production evidence
are still pending. It may use labeled fixture records only.

- No fixture is an SSOT decision, production price, ERP order, financial fact,
  shipment/POD, official document, signed baseline or release-gate evidence.
- `implementationAuthorized`, `productionReady`, RG-01, RG-02 and the 0/16
  release-gate state remain unchanged.
- Fixture replacement must use the governed Imports/DQ/reconciliation path;
  no one-off production seeding is allowed.
- User-facing demo screens must visibly state `DEMO / STAGING DATA`.
