# Go-Live Cutover Runbook

Status: READY FOR REVIEW / NOT EXECUTED.

| Checkpoint | Owner role             | Action and expected evidence                                                      | Rollback trigger                    | Status  |
| ---------- | ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | ------- |
| T-7 days   | Release Manager        | Freeze scope; confirm gates, owners, UAT, access, training and source register    | Any mandatory item missing          | PENDING |
| T-3 days   | Data Migration Owner   | Validate signed extracts, counts, hashes, staging DQ and reconciliation           | Count/hash or DATA_CONFLICT failure | PENDING |
| T-1 day    | Cloud/Security Owners  | Confirm backup, restore point, Entra/MFA, Key Vault, private network, WAF, alerts | Control/evidence missing            | PENDING |
| T-4 hours  | Release Manager        | Verify approved commit/digests, migration plan and rollback rehearsal             | Artifact drift or rehearsal failure | PENDING |
| T-1 hour   | Business/Product Owner | Confirm business freeze and Go/No-Go attendance                                   | Business freeze not confirmed       | PENDING |
| T-0        | Technical Owner        | Deploy only via GitHub OIDC/Bicep, apply migrations, record run IDs/digests       | Deployment/migration/health failure | BLOCKED |
| T+1 hour   | QA/Security Owners     | Safe smoke tests: auth, dashboard, reads, portal isolation, worker, blob, audit   | Critical security/auth/data failure | PENDING |
| T+4 hours  | Operations Owner       | Review errors, latency, jobs, outbox, imports, DQ and alerts                      | Sustained severe regression         | PENDING |
| T+24 hours | Business/Product Owner | Reconcile business counts and priority workflows                                  | Material reconciliation mismatch    | PENDING |
| T+72 hours | Hypercare Lead         | Review incidents, access, capacity and handover                                   | Unresolved critical incident        | PENDING |

No production action is authorized while the final decision is NO-GO.
