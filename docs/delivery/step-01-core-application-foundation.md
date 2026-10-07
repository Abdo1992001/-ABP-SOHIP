# Step 1 — Core Application Foundation

Current verdict: PASS.

## Closed local evidence

| Item                                                          | Status | Evidence                                                                                            |
| ------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Monorepo, API, Web, Worker and shared packages                | PASS   | Workspace checks pass.                                                                              |
| PostgreSQL / Prisma / migrations                              | PASS   | 13 migrations clean-deployed into an isolated PostgreSQL database.                                  |
| Transaction, audit, outbox and durable jobs                   | PASS   | Real PostgreSQL integration suite: 12/12 tests.                                                     |
| Atomic commit/rollback and append-only redacted audit         | PASS   | Integration proof covers both behaviors.                                                            |
| Outbox/job concurrency, leases, retries, DEAD and idempotency | PASS   | Integration proof covers every scenario.                                                            |
| Platform end-to-end proof                                     | PASS   | API → PostgreSQL transaction → audit → outbox → worker → durable job → completed state.             |
| Worker runtime/health                                         | PASS   | Dependency-backed polling is proven.                                                                |
| Governance guard                                              | PASS   | Pre-authorization status remains unchanged.                                                         |
| Final Windows verify                                          | PASS   | corepack pnpm verify exited 0.                                                                      |
| Docker API                                                    | PASS   | Built and inspected.                                                                                |
| Docker Worker                                                 | PASS   | Built and inspected.                                                                                |
| Docker Web                                                    | PASS   | Built and inspected.                                                                                |
| Bicep foundation                                              | PASS   | Required Azure modules are present. Bicep CLI is not installed locally.                             |
| Observability foundation                                      | PASS   | Structured logs and trace/correlation plumbing exist. Production validation is deferred to Step 11. |
| Demo data isolation                                           | PASS   | Fixtures remain DEMO/STAGING ONLY, never SSOT, production seeds or release evidence.                |

Evidence artifacts:

- .tmp/step1-evidence/pnpm-verify-result.json
- .tmp/step1-evidence/docker-api-result.json
- .tmp/step1-evidence/docker-worker-result.json
- .tmp/step1-evidence/docker-web-result.json

## Windows path issue

RESOLVED. The final evidence runner derives the repository root from
import.meta.url and direct-spawns its child processes with shell false. The
[ABP] repository segment is no longer sent through wildcard-sensitive PowerShell
path resolution.

## Render staging preparation

ENVIRONMENT = STAGING ONLY.

render.yaml defines same-region staging PostgreSQL 17, API, Worker and Web
resources. It uses private Render database connection strings for API and
Worker, blocks public database access, gives schema-migration ownership only to
the API pre-deploy command, and uses the actual API readiness route.

The API accepts explicitly listed origins only; the Web receives its API origin
at container startup. No wildcard CORS, production identity, production data,
database password or secret is committed.

The current Web staging image built successfully as
abp-web:render-staging-verify. A local container smoke returned HTTP 200 for
the application shell and runtime-config.js with its injected staging API base
URL.

The full external deployment/evidence procedure is in
docs/deployment/render-staging.md. Render is implementation/test evidence only;
Azure and Bicep remain the locked production deployment authority.

## SSOT deviations

0. The architecture guards preserve no formal quotation revisions, no internal
   ERP order lifecycle, no capacity reservations/MES, no Shipment/POD execution and
   no Redis/Kafka/RabbitMQ/Elasticsearch Day 1.

## Final acceptance boundary

Step 1 closes on a working, verified platform foundation. Render staging and a
remote GitHub Actions run were prepared as optional external evidence paths
while local Windows evidence capture was unresolved; they are not Step 1 SSOT
requirements. Local evidence capture is now reproducible through Docker
Compose and the authoritative `corepack pnpm verify` command.

| Mandatory evidence                               | Status | Evidence                                                                                                        |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| Web runtime                                      | PASS   | Local Docker Web serves the application shell on port 8080.                                                     |
| API readiness                                    | PASS   | `/api/v1/health/ready` reports PostgreSQL UP.                                                                   |
| Worker readiness                                 | PASS   | `/health/ready` reports live and ready polling.                                                                 |
| PostgreSQL / Prisma                              | PASS   | PostgreSQL 17 and Prisma are exercised by the local stack.                                                      |
| Migrations                                       | PASS   | 13 migrations are clean-deployed by the single `migrate` Compose service.                                       |
| Verification suite                               | PASS   | `corepack pnpm verify` exited 0.                                                                                |
| Docker API / Worker / Web                        | PASS   | All production-style images build and run locally.                                                              |
| Browser CORS                                     | PASS   | API allows the explicit local Web origin only; no wildcard is used.                                             |
| Transaction manager, audit, outbox, durable jobs | PASS   | Real PostgreSQL integration suite and platform proof cover the chain.                                           |
| Platform E2E                                     | PASS   | API request created a proof event; the separate Worker claimed it and PostgreSQL recorded `COMPLETED`.          |
| CI workflow foundation                           | PASS   | The workflow provisions PostgreSQL 17, migrates, runs `pnpm verify` without masking failures, and uploads logs. |
| Bicep / observability foundations                | PASS   | Azure IaC modules and structured trace/correlation logging remain in place.                                     |
| SSOT deviations                                  | PASS   | 0.                                                                                                              |

## Deferred external evidence

- GitHub Actions remote execution: DEFERRED — remote execution evidence is
  useful for collaboration but is not a Step 1 closure condition because the
  same authoritative verification command has already passed locally.
- Render staging: OPTIONAL / NOT REQUIRED FOR STEP 1. `render.yaml` remains
  STAGING-only preparation and never changes Azure as the production authority.
- Production Azure validation: DEFERRED TO STEP 11/12.
- Production observability: DEFERRED TO STEP 11.
- Bicep CLI compilation: TOOLING EVIDENCE DEFERRED; the local machine does not
  have the Bicep CLI.

## Source synchronization

Local source integrity: PASS. Commit `6272ee0` is synchronized with `origin/main`.
Remote CI execution status is deliberately separate from this source-integrity
record.
