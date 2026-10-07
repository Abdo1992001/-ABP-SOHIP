# WS0 technical foundation

## Delivery state

The codebase is technical preparation only. It does not alter or sign Baseline R1.

## Sales-first composition

Sales owns the primary shell and navigation: customers, contacts, projects, opportunities, activities, pricing, quotations, target/contribution, ERP history, and customer intelligence.

Sales Management and Sales Support are permissioned views inside the Sales workspace. They are not independent business domains and do not bypass Country Scope.

Logistics, Operations, and Finance remain isolated workspaces. Results return to Sales through safe projection contracts; a returned status is not reverse workspace access.

## Backend modules

The modular monolith uses bounded modules for identity/access, Sales/CRM, pricing, quotations, ERP orders, capacity, logistics, finance, returns/complaints, imports/DQ, analytics/advisory, documents, notifications, and admin/audit.

Cross-cutting platform code is limited to authorization, time/IDs, database transactions, audit, outbox, durable jobs, errors, and observability. Domain rules do not move into shared utilities.

## D9-001

WS0 started with OpenAPI 3.1 and a minimal typed platform contract. WS1 subsequently closed D9-001 with the authoritative 171-operation V1 inventory, deterministic generated client, drift gate, and runtime contract tests. Contracted operations remain disabled until their implementation slices are delivered; no fake domain endpoints are exposed.

## Data guards

- Country Scope is mandatory and evaluated before ownership/share.
- ERP orders are imported read-only facts.
- Quotations have no formal revisions; replacements use `supersedes_quotation_id` when implemented.
- Capacity is 900/700/600 + 24h, estimate-only.
- Logistics is planning-only, Flat-on-Face, without Shipment/POD.
- Audit, outbox, and jobs are durable database records, never console-only truth.

## PostgreSQL transaction boundary

Application services own atomic boundaries through `TransactionManager.run(context, work)`. The callback receives a database-only transaction client; DTOs and controllers never expose it. HTTP, mail, storage, identity-provider calls, and other network I/O are prohibited inside the callback. Normal writes use Prisma interactive transactions. Queue/job claims and idempotent concurrent submissions use explicit parameterized PostgreSQL SQL where row locking or atomic conflict handling is required.

## Audit, outbox, and jobs

- Audit events are appended in the caller's transaction. Snapshots and metadata recursively redact password, token, cookie, authorization, secret, and API-key fields. A database trigger rejects every `UPDATE` or `DELETE`, and public mutation privileges are revoked.
- A business change and its outbox message use the same transaction. Claims use `FOR UPDATE SKIP LOCKED`, bounded leases, at-least-once delivery, bounded retry, and terminal `DEAD` state.
- Durable jobs use the same lease/claim model, progress, result references, error codes, trace/correlation propagation, and an atomic idempotency key per job type.
- Worker handlers must be idempotent. A lease can expire after an external side effect and before acknowledgement, so the system never assumes exactly-once delivery.

## Worker runtime

The worker has configurable batch size, polling delay, lease duration, and exponential retry bounds. `SIGINT`/`SIGTERM` stop polling, close the health server, and disconnect PostgreSQL. `/health/live` reports process liveness and `/health/ready` becomes ready only after a successful database poll. Structured logs contain identifiers and error codes, never raw payloads.

## Verification commands

With `DATABASE_URL` and `TEST_DATABASE_URL` pointing to a migrated PostgreSQL 17 database:

1. `corepack pnpm db:generate`
2. `corepack pnpm db:migrate:deploy`
3. `corepack pnpm test`
4. `corepack pnpm proof:platform`
5. `corepack pnpm verify`

The proof endpoint is disabled unless `ABP_PLATFORM_PROOF_ENABLED=true`; the proof command enables it only for its process and uses `PlatformProofRun` synthetic technical records, not Customers, Quotations, ERP orders, or other business objects.
