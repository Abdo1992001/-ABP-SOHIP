# Acceptance Matrix

| Gate                   | Evidence                                                                    | Result  |
| ---------------------- | --------------------------------------------------------------------------- | ------- |
| Repository identity    | HEAD `6da63e2a...`; demo tag at HEAD; remediation uncommitted               | PARTIAL |
| Steps 2–4 architecture | 16/10 checks; 35 screens; 239 typed operations mapped                       | PASS    |
| Step 5 data model      | 61 entities, 22 aggregates, 239 operations, 218 supported, 0 SSOT           | PASS    |
| Step 6 PostgreSQL      | migrations/schema pass; running PostgreSQL 16.15 vs proof baseline 17       | PARTIAL |
| OpenAPI                | 218 typed/implemented; refs, duplicate IDs, placeholders and drift 0        | PASS    |
| Builds                 | web/API/worker/desktop/mobile/database/contracts build; vendor-three 681 kB | PASS    |
| Tests                  | full `pnpm test` succeeds; integration 22/22; auth 4/4                      | PASS    |
| Lint/types/format      | all pass                                                                    | PASS    |
| Dashboard data         | API-backed target, pipeline, geography, opportunities, activities, calendar | PASS    |
| Scroll                 | browser wheel + Home/PageDown/End reached bottom; 1945/912                  | PASS    |
| Docker images          | API, worker, web, migrate built                                             | PASS    |
| Docker runtime         | only Compose db is running; API/worker/web are host processes               | PARTIAL |
| Security               | 2 high + 8 moderate audit advisories remain                                 | FAIL    |
| Backup/restore         | real dump, isolated restore, verification and cleanup                       | PASS    |
| Production             | identity/HTTPS/ops/E2E and several screens unproven                         | FAIL    |
