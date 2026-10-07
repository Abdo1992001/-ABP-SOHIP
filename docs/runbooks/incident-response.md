# Incident response

Severity baseline: SEV-1 is active security/data-integrity loss or broad outage; SEV-2 is major degraded operation; SEV-3 is limited impact; SEV-4 is informational. Organizational assignees remain DEP-004.

1. Detect and acknowledge from Azure Monitor/App Insights, WAF, audit, backup, source-freshness, job, and application alerts.
2. Create an incident record with severity, trace/correlation IDs, affected countries/workspaces, first observed time, reporter, and evidence links. Never place secrets or unrestricted payloads in the record.
3. Contain: revoke sessions/roles, disable a user or provider, stop an import/export, isolate a revision, or rotate a Key Vault secret. DENY and Country Scope remain enforced during response.
4. Preserve immutable audit, application/security logs, deployment digests, and database timeline. Do not delete suspected artifacts.
5. Recover using tested rollback/restore procedures, then validate authorization, reconciliation, and backlog recovery.
6. Notify through the approved external communications plan; no contacts are invented here.
7. Complete a blameless postmortem with timeline, root cause, control failure, actions, owners, deadlines, and verification.
