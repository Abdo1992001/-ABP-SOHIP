# Step 12 — Non-People Launch Decision Pack

Status: **READY FOR BUSINESS DECISIONS**
Scope: decisions only; no feature development and no Production deployment.

Technical baseline is unchanged: RC `31b58204a65756451b75565422103abe4ec97826`; OpenAPI/client `1.6.0`; runtime `217/217`; 35 migrations; 55/55 screens; 195/195 actions; drift and SSOT deviations zero.

## D-01 — Contacts source strategy

Current source: **NOT FOUND** after auditing 10 workbooks. Contact records must never be inferred or fabricated.

| Option              | Business impact                                                 | Cutover impact                                            | Data impact                                                                             | Risk                                                                      |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A — NEW SYSTEM ONLY | No historical Contacts; users build a governed directory in ABP | Removes Contact migration from initial cutover            | Zero migrated rows; all new records have ABP lineage/audit                              | Customer records initially lack named contacts until users add them       |
| B — MIGRATION LATER | Trusted history may be recovered later                          | Initial launch proceeds; later controlled import required | Future source must include customer linkage, source keys, hashes, DQ and reconciliation | A delayed import can create duplicates without governed entity resolution |

Option C is unavailable: repository evidence identifies no real authoritative alternative.

Recommendation: **Option A — NEW SYSTEM ONLY** for initial V1. A later migration is allowed only as a separately governed change after a real source is approved. Business decision required: **YES**.

## D-02 — Customer cutover strategy

- Current source: `customer list.xlsx`
- SHA-256: `1436e626c548ea5daf11548c02f2471ab420e4e3ad8f29a018ea7f50a6693c11`
- Local staging: **121/121 PASS**, 0 rejected, 0 conflicts.

| Option | Decision                                                                                                            | Implication                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A      | Approve the current file as the initial migration-source design, then require a fresh final extract/hash at cutover | Preserves current snapshot != final extract and captures source changes before launch |
| B      | Explicitly freeze the current binary as final                                                                       | Fastest, but excludes all later source changes                                        |
| C      | Replace it with another approved ERP extract and rerun DQ/reconciliation                                            | Use only if a superior canonical export is identified                                 |

Recommendation: **Option A**.

Required cutoff evidence: exact filename; extraction/cutoff timestamp; SHA-256; source and excluded-row counts; 121 canonical candidates or documented actual final count; DQ status; source-to-staging-to-canonical reconciliation; Business/Data approval.

Business decision required: **YES**.

## D-03 — Product/SKU cutover strategy

- Current source: `pvc codes.xlsx`
- SHA-256: `a87ec0402be5c26210dd3b86d780119991b33c38c57c79dc244e0d92354079dd`
- Local staging: **2914/2914 PASS**, 0 rejected, 0 conflicts; 66/66 review rows dispositioned.

| Option | Decision                                                                                   | Implication                                                               |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A      | Approve current workbook as master-seed design, then refresh/freeze final binary at cutoff | Preserves tested grammar/crosswalk while accepting final master changes   |
| B      | Freeze current binary now                                                                  | Deterministic but excludes later approved SKU changes                     |
| C      | Use governed ERP/master sync if a real authoritative product master is confirmed           | Requires source keys, schema, DQ, reconciliation and integration evidence |

Recommendation: **Option A**; select C only after a real authoritative ERP master is proven. Business decision required: **YES**.

## D-04 — ERP and Finance sources

| Domain                        | Canonical truth owner     | Required source and current integration                                                                       | Availability                                       | Classification                                               | Cutover requirement                                                                                 |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| ERP Orders / Commercial Facts | ERP + Business/Data owner | Approved ERP API/export; idempotent private import/sync with raw lineage, DQ and reconciliation               | Discovery workbook only; Production source pending | LIVE ERP IMPORT/SYNC — CURRENTLY PENDING SOURCE              | Source/owner/method/schema/cutoff/hash/count; Booked/Shipped/Invoiced separation; DQ/reconciliation |
| FX                            | Finance                   | Approved USD/EGP authority; effective-dated import/API or manually approved seed; no overlap/silent overwrite | PENDING SOURCE                                     | LIVE SYNC OR MANUAL APPROVED SEED — CURRENTLY PENDING SOURCE | Authority, effective periods, values, coverage reconciliation and Finance approval                  |
| Payments                      | Finance source system     | Trusted transactional API/export; restricted import with source keys and correction history                   | PENDING SOURCE                                     | LIVE ERP IMPORT/SYNC — CURRENTLY PENDING SOURCE              | Owner/extract/cutoff/hash/count/source-fact reconciliation; no invented AR/revenue                  |
| Cheques                       | Finance source system     | Trusted transactional API/export; restricted import with correction lineage                                   | PENDING SOURCE                                     | LIVE ERP IMPORT/SYNC — CURRENTLY PENDING SOURCE              | Owner/extract/cutoff/hash/count/validation/reconciliation                                           |

Decisions required: ERP Production source and API/export method; owners; FX rate authority and seed/sync method; Payment and Cheque sources; cutoff/schema/file-or-API evidence/SHA-256/counts/DQ/reconciliation for each.

## D-05 — Other cutover data

| Domain                          | Recommended V1 classification                          | Guardrail                                                                                         |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Complaints                      | NEW SYSTEM ONLY                                        | No legacy history without a real approved source                                                  |
| User Accounts                   | EXTERNAL IDENTITY PROVISIONING                         | Verified Entra/external identities only; no display-name spreadsheet migration                    |
| Role Assignments                | CONFIGURED AT GO-LIVE                                  | Governed identity-to-role bindings and least privilege                                            |
| Country Scope                   | CONFIGURED AT GO-LIVE                                  | Explicit server-side user-country assignments; cannot be widened by share/ownership/manager logic |
| R&D Access                      | CONFIGURED AT GO-LIVE                                  | View-only and intersected with Country Scope and DENY                                             |
| Client Portal Customer Bindings | EXTERNAL IDENTITY PROVISIONING + CONFIGURED AT GO-LIVE | Explicit audited identity-to-customer binding; no inferred mapping                                |

Business decisions required: confirm Complaints as new-system-only or provide a real source; approve identity authority; approve role, Country Scope, R&D and Client-binding configuration policies.

## D-06 — Production workload profile

Status: **PROPOSED**.

| Measure                        |              LOW |        EXPECTED |                         PEAK |
| ------------------------------ | ---------------: | --------------: | ---------------------------: |
| Concurrent Internal Users      |               10 |              25 |                           60 |
| Concurrent Client Portal Users |               10 |              20 |                          100 |
| Requests/sec                   |                5 |              10 |                           30 |
| Search/min                     |               15 |              30 |                          120 |
| Dashboard Loads/min            |               10 |              30 |                          120 |
| Quotation Autosaves/min        |               10 |              20 |                           80 |
| Pricing Previews/min           |               15 |              30 |                          120 |
| Analytics Queries/min          |               10 |              20 |                           60 |
| Exports/hour                   |                2 |               5 |                           20 |
| ERP Import Size — rows         |           10,000 |          50,000 |                      250,000 |
| ERP Import Max File Size       |           25 MiB |         100 MiB |                      250 MiB |
| ERP Import Frequency           | weekly/on-demand | daily/on-demand | daily plus controlled replay |
| Complaint Transactions/day     |               10 |              25 |                          100 |
| Shipment Updates/day           |               20 |              50 |                          200 |
| Document Uploads/day           |               20 |              50 |                          200 |
| Worker Jobs/min                |                5 |              10 |                           40 |
| DB Connection Expectations     |             5–20 |           10–40 |                        20–80 |

Recommendation: **APPROVE AS INITIAL PRODUCTION BASELINE**. The values are bounded and compatible with the modular-monolith/PostgreSQL worker design, while current local evidence shows technical headroom. This recommendation is not approval; RG-08 still requires a representative Production-like load/spike/soak run using the approved Peak profile.

Business approval required: **YES**.

## D-07 — Retention matrix

All values are engineering proposals, not legal conclusions.

|   # | Data Category               | Proposed Retention                                                     | Archive/Delete Rule                                            | Immutability              | Existing Engineering Baseline            | Approval Impact                     |
| --: | --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------- | ---------------------------------------- | ----------------------------------- |
|   1 | Critical Audit              | 7 years after event                                                    | Partition/archive then approved purge                          | Yes                       | 7 years                                  | Business + Legal + Security         |
|   2 | Security Audit              | 1 year searchable; incident/legal-hold extension only                  | Retention policy + legal hold                                  | Yes                       | 1 year                                   | Security + Legal                    |
|   3 | Access Events               | 1 year                                                                 | Policy purge/legal hold                                        | Yes                       | 1 year                                   | Security + Legal                    |
|   4 | Authentication Events       | 1 year                                                                 | Identity/log retention                                         | Yes                       | 1 year                                   | Security + Legal                    |
|   5 | Application Logs            | 90 days searchable                                                     | Log Analytics retention                                        | No                        | 90 days searchable                       | Technical + Security                |
|   6 | Infrastructure Logs         | 90 days searchable                                                     | Log Analytics retention                                        | No                        | 90 days searchable                       | Technical + Security                |
|   7 | ERP Raw Import              | 7 years after import, subject to source-data policy                    | Immutable private object/version retention then approved purge | Yes                       | 7-year candidate                         | Business + Legal + Data Owner       |
|   8 | ERP Reconciliation Evidence | 7 years after run                                                      | Immutable evidence archive                                     | Yes                       | 7-year candidate                         | Business + Legal + Data Owner       |
|   9 | Quotations                  | 7 years after terminal state proposal                                  | Archive; purge only with no hold/dependency                    | SENT immutable            | No approved duration                     | Business + Legal                    |
|  10 | Official PDFs               | Same as governing quotation; proposed 7 years                          | Private versioned object storage                               | Yes                       | Immutable history required               | Business + Legal                    |
|  11 | Customers                   | Active lifecycle + approved post-relationship period                   | Archive/restricted projection/approved anonymize or purge      | No                        | No approved duration                     | Business + Legal/Privacy            |
|  12 | Contacts                    | Active need + approved post-relationship period                        | Archive/anonymize/purge with audit preservation                | No                        | No approved duration                     | Business + Legal/Privacy            |
|  13 | Projects                    | 7 years after closure proposal                                         | Archive/purge policy                                           | No                        | No approved duration                     | Business + Legal                    |
|  14 | Opportunities               | 7 years after terminal state proposal                                  | Archive/purge policy                                           | No                        | No approved duration                     | Business + Legal                    |
|  15 | Activities                  | Related Customer/Opportunity policy; proposed maximum 7 years          | Archive/purge with parent policy                               | No                        | No approved duration                     | Business + Legal/Privacy            |
|  16 | Complaints                  | 7 years after closure proposal                                         | Archive; attachment purge subject to hold                      | History immutable         | No approved duration                     | Business + Legal/Quality            |
|  17 | Shipment History            | 7 years after final milestone proposal                                 | Archive; no history overwrite                                  | Yes                       | Milestone/correction history immutable   | Business + Legal/Logistics          |
|  18 | Payments                    | 7 years after source fact proposal                                     | Restricted archive/correction history                          | Source/correction history | No approved duration                     | Finance + Legal                     |
|  19 | Cheques                     | 7 years proposal                                                       | Restricted archive/purge policy                                | History                   | No approved duration                     | Finance + Legal                     |
|  20 | Returned Scrap              | 7 years after decision proposal                                        | Immutable calculation/approval evidence archive                | Yes                       | Audited approval/original-price evidence | Finance + Business + Legal          |
|  21 | Documents                   | Governing record; working files 1 year after replacement proposal      | Versioned private-object lifecycle                             | Official versions         | Official history immutable               | Business + Legal + Security         |
|  22 | Client Portal Audit         | 1 year; longer under incident/legal hold                               | Immutable audit retention                                      | Yes                       | 1-year access baseline                   | Security + Legal/Privacy            |
|  23 | R&D Analytics Evidence      | 1 year result evidence; source follows source policy                   | Aggregate evidence purge; lineage separately governed          | Published evidence        | No approved duration                     | Business/Data + Legal/Privacy       |
|  24 | PITR                        | 14 days                                                                | Azure PostgreSQL managed PITR                                  | Provider controlled       | 14 days                                  | Technical + Security + Legal        |
|  25 | Daily Backups               | 35 days                                                                | Managed/logical lifecycle                                      | Yes                       | 35 days                                  | Technical + Security + Legal        |
|  26 | Monthly Backups             | 12 months                                                              | Backup archive lifecycle                                       | Yes                       | 12 months                                | Technical + Security + Legal        |
|  27 | Exports                     | 24-hour service copy; recipient responsibility after download proposal | Automatic object deletion + download audit                     | No                        | Short-lived authorized download          | Business + Security + Legal/Privacy |
|  28 | Temporary Signed URLs       | Maximum 15 minutes; retain only audit-safe metadata                    | Expiry + key rotation                                          | No                        | Short-lived; no public storage           | Security                            |

Undefined items: **2** — exact post-relationship durations for Customers and Contacts.

Recommendation: **REQUIRES CHANGES**. Define those two exact periods, then obtain Business/Legal/Privacy/Security approval. The remaining 26 engineering proposals are ready for governance review but are not legally approved.

## D-08 — DR malware scanning

Primary: **UAE North**. Current DR candidate: **UAE Central**.

| Dimension       | Option A — UAE Central + alternative scanner                                                 | Option B — another supported region                         | Option C — security exception                                           |
| --------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Security        | Equivalent private quarantine, verdict, audit, alerting and failure-closed behavior required | Strongest managed parity if support is verified             | Explicit residual-risk acceptance and compensating controls             |
| Cost/complexity | Medium/high: scanner compute, signatures, scaling and monitoring                             | Medium: region/residency/networking/service-parity redesign | Low immediate effort; high governance/remediation debt                  |
| RTO/RPO         | Scanner startup/capacity must fit RTO; DB RPO unchanged                                      | Replication distance and latency require measurement        | Topology unchanged, security degraded in DR                             |
| Architecture    | Quarantine → private scanner → clean promotion                                               | Region pair/network/replication/Front Door/storage change   | Compensating quarantine/manual controls only                            |
| IaC             | Add scanner workload, identity, endpoints, events, alerts and failure policies               | Parameterize and validate replacement region/resources      | Exception metadata and compensating controls                            |
| Operations      | Patch/signature ownership, capacity tests and runbook                                        | New failover/access/residency runbooks                      | Manual review/escalation and expiry tracking                            |
| Go-Live         | RG-09 waits for equivalence and formal DR test                                               | RG-09 waits for region approval/parity/drill                | Requires explicit Security and Business acceptance; not for convenience |

Recommendation: **Option A first** to preserve the selected UAE Central topology. If equivalent failure-closed scanning cannot be proven within the release window, select **Option B**. Do not select Option C by default. Decision required: **YES**.

## Deferred people items

- HI-001 Staffing: **DEFERRED BY BUSINESS**
- HI-002 Training attendance: **DEFERRED BY BUSINESS**
- HI-010 UAT participants/execution: **DEFERRED BY BUSINESS**
- HI-011 Production access roster: **DEFERRED BY BUSINESS**

## Closure status

- Non-people decisions required: **8** — D-01 through D-08.
- Technical changes: **0**.
- OpenAPI/client/runtime: unchanged.
- Step 12: **BLOCKED**.
- Production Ready: **NO**.
- Production Deployment: **NOT EXECUTED**.
