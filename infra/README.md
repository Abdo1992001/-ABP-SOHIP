# Infrastructure templates

These Bicep files are non-production WS0 templates. `main.bicep` only accepts `dev`, `ci`, or `staging`; production is intentionally excluded until RG-01 and implementation authorization are complete.

Passwords and secrets shown as placeholders must never be used in a deployment. Production-grade secret injection, private DNS links/endpoints, Defender for Storage proof, Front Door/WAF, zone-redundant PostgreSQL HA, DR, policy assignments, and exact SKUs remain evidence-backed implementation work.
