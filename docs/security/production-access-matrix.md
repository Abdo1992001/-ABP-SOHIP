# Production access matrix

Actual people/rosters are governed by DEP-008; this file defines roles only.

| Category              | Default access                            | Prohibited by default                                     | Control                                 |
| --------------------- | ----------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| Developers            | telemetry and redacted diagnostics        | production data writes, DB owner, Key Vault secret values | JIT approval and audit                  |
| Deployment automation | deploy approved immutable digests and IaC | interactive sign-in, business data access                 | GitHub OIDC federated identity          |
| DB operators          | JIT restore/migration operations          | application use, shared superuser                         | separate migration/operator roles       |
| Security              | alerts, audit/security evidence           | commercial edits                                          | least privilege and case reference      |
| Support               | approved projections and diagnostics      | Finance restricted fields, blanket Country Scope          | ticket/context-bound access             |
| Finance               | contracted Finance projections/actions    | Sales administration                                      | RBAC + field projection + Country Scope |
| Operations            | demand/capacity/DQ projections            | full CRM or Finance                                       | workspace projection                    |

Break-glass accounts are individual, phishing-resistant MFA protected, time limited, audited, and post-reviewed.
