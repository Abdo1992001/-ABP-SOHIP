# Production rollback

Rollback is revision/digest based. Never rebuild during an incident and never reverse an irreversible migration blindly.

1. Declare incident severity, stop new deployments/imports/exports, preserve audit/log evidence, and identify the last known-good immutable digest and schema compatibility.
2. If the schema is backward compatible, shift traffic to the last healthy Container Apps revision and verify readiness/authz. For expand/contract deployments, prefer forward-fix; do not drop expanded columns during rollback.
3. If data integrity is affected, isolate writes, capture a forensic backup, and restore to an isolated database first. Production PITR requires explicit incident authority and reconciliation of writes after the restore point.
4. Drain workers before switching versions. Expired leases may be reclaimed; idempotency/outbox guarantees must prevent duplicate business effects.
5. Validate Country Scope, DENY, quotation immutability, ERP read-only facts, audit append-only behavior, and DQ/reconciliation counts.
6. Record timestamps, digests, database point, decisions, residual impact, and post-incident actions.
