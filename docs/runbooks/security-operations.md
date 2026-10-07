# Security operations

- Entra MFA is mandatory; phishing-resistant methods are preferred for privileged/Finance access. Conditional Access evidence is DEP-001.
- Standard sessions use 30-minute idle/12-hour absolute limits and five concurrent sessions; privileged sessions use 15-minute idle/8-hour absolute limits and three concurrent sessions. Recent authentication is ten minutes.
- Disablement, role/permission/Country Scope/DENY changes increment policy version and invalidate stale server sessions. Explicit revocation is immediate.
- Use individual least-privilege accounts. Break-glass access requires strong MFA, time-limited activation, immutable audit, stated reason, and post-use review; never use a shared administrator password.
- Rotate and reference secrets through Key Vault/managed identity. Keep secrets out of source, frontend, Docker layers, logs, snapshots, and evidence.
- Quarantine uploads until validation/malware verdict. Never bypass scanning. UAE Central scanner capability remains DEP-003.
- Review Critical immediately; no exception is allowed. High risk requires remediation before release unless formal owner, mitigation, expiry and gate evidence exist. Current local dependency evidence permits no Critical/High.
- Audit and raw-import retention engineering baseline is seven years, security/access one year, searchable technical logs 90 days; formal approval remains DEP-007.
