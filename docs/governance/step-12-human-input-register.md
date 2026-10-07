# Step 12 Human Input Register

People-related identities and attendance are explicitly deferred by the Business. They remain release blockers but are not requested in this run. Non-people launch decisions are grouped separately and fully detailed in `step-12-non-people-decision-pack.md`.

## Non-people decisions — 8

| ID   | Decision                                  | Recommendation                                                            | Status                             |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| D-01 | Contacts source strategy                  | New-system-only for initial V1                                            | Pending Business decision          |
| D-02 | Customer final extract/freeze strategy    | Fresh final extract/hash at cutoff                                        | Pending Business decision          |
| D-03 | Product/SKU final extract/freeze strategy | Refresh/freeze final binary at cutoff                                     | Pending Business decision          |
| D-04 | ERP, FX, Payments and Cheques sources     | Trusted governed import/sync sources                                      | Pending Business/Finance decision  |
| D-05 | Other cutover classifications             | New-system/external provisioning/configuration according to domain        | Pending Business/Security decision |
| D-06 | Low/Expected/Peak workload                | Approve as initial production baseline, then formally test                | Pending Business decision          |
| D-07 | 28-category retention matrix              | Define Customer/Contact periods before approval                           | Pending governance decision        |
| D-08 | DR malware scanning                       | UAE Central equivalent control first; another region if equivalence fails | Pending Security/Business decision |

## People-related items — deferred by Business

| ID     | Topic                                  | Status               | Release impact             |
| ------ | -------------------------------------- | -------------------- | -------------------------- |
| HI-001 | Staffing owners/backups                | DEFERRED BY BUSINESS | Operational readiness open |
| HI-002 | Training attendees/execution           | DEFERRED BY BUSINESS | RG-13 open                 |
| HI-010 | UAT participants/execution             | DEFERRED BY BUSINESS | RG-11 open                 |
| HI-011 | Production access roster/certification | DEFERRED BY BUSINESS | RG-12 open                 |

## External execution dependencies

- EX-01: Production-like load/spike/soak run after D-06 approval.
- EX-02: Formal staging cutover/rollback after decisions, staging and real evidence exist.

Step 12 remains **BLOCKED**. Production Ready remains **NO**. Production Deployment remains **NOT EXECUTED**.
