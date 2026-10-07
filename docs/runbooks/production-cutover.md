# Production cutover

This runbook is executable only in Step 12 after RG-01 through RG-15 evidence is accepted. It does not authorize deployment.

1. Record approved commit, immutable API/worker/web image digests, OpenAPI/client hashes, migration set, source extract hashes, owners, maintenance window, and rollback decision authority.
2. Confirm Entra Conditional Access/MFA, Key Vault references, private PostgreSQL/Blob networking, WAF, alerts, backup freshness, UAT roster, access certification, and DEP-001..008 evidence.
3. Freeze source changes, export canonical source data, validate hashes/counts, and execute the approved rehearsal-tested migration/import sequence.
4. Deploy the same tested digests. Run expand migrations with the migration identity before application traffic. Never run manual production DDL.
5. Validate readiness, authentication, Country Scope, DENY, quotation, ERP read-only, capacity estimates, logistics planning, finance projections, documents, jobs, analytics reconciliation, Arabic/English, and audit/outbox.
6. Observe error rate, latency, DB saturation, job backlog, import/DQ freshness, and security alerts through the agreed soak window.
7. Record evidence and request the Step-12 Go/No-Go. If any abort condition occurs, invoke `production-rollback.md`.

Abort conditions include authorization leakage, migration integrity failure, unavailable restore point, critical security alert, unreconciled source counts, or sustained SLO breach. Named contacts are intentionally not invented; DEP-004/DEP-008 supply them.
