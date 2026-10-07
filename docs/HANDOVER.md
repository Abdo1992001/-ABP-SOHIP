# ABP Commercial System — handover to IT

This document is the starting point for the team taking the system forward:
what it is for, what it does today, how to run it, how it is built, what has
been decided, and what is still to do — in priority order.

---

## 1. The concept

**From manual work to connected commercial operations.**

ACROW Building Products (ABP) grew faster than the tools behind its commercial
work. Customer details, quotations, follow-ups, orders, collections and
deliveries lived in separate spreadsheets, personal files and messages, so the
same work was repeated, numbers did not agree, and management saw the picture
late.

The system is not a software project for its own sake. It turns that
fragmented work into one controlled, visible, measurable commercial process:

**Identify → Standardise → Automate → Integrate → Centralise → Measure → Scale.**

Goals:

| Goal                      | What it means in practice                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| One source of truth       | Every customer, quotation, order and payment lives in one place, under the company's control.   |
| Less manual work          | Technical calculations, takeoff, pricing and documents are produced by the system, not retyped. |
| Faster execution          | A quotation, an order confirmation or a follow-up is minutes, not hours.                        |
| Visibility for management | Pipeline, targets, receivables, production and deliveries are visible as they happen.           |
| Control                   | Approvals, price floors, audit trail and role-based access are enforced by the server.          |
| Scale                     | New salespeople, countries and products are added without new spreadsheets.                     |

The connected chain the system follows:

**Customer → Contact → Project → Opportunity → Activity → Quotation →
Approval → Order → Production → Shipment → Delivery → Payment → Feedback.**

---

## 2. What the system does today

82 screens, organised by department. Sales is the core workspace; the other
departments see what they need through permissioned views.

**Sales**

- Customers (Customer 360: contacts, projects, opportunities, quotations,
  orders, receivables, feedback), contacts, projects, opportunity pipeline,
  activities and calendar.
- Quotation wizard and Quotation Studio: technical takeoff, board layout,
  pricing rules and price floors, approvals, official PDF, Excel and Word
  export, revisions (a sent quotation is superseded, never edited).
- Sending a quotation by email from the system, PDF attached, replies to the
  salesperson — or recording that it was sent by hand.
- Customer orders booked from accepted quotations; amendments; payment
  schedule; emailing the customer an order confirmation PDF.
- Customer feedback (public form at `/feedback`, no login), complaints with a
  routed workflow (sales → operations → quality → solution), customer map
  (Egypt and world, by district, with pins and bulk pin upload).

**Sales management** — command centre, company and per-person targets,
reports, repeat business, AI advisory brief, market intelligence screens.

**Operations** — capacity estimates, work orders, production timeline (Gantt)
against the customer's requested date.

**Logistics** — load plans, Cargo Loader (container/truck packing, 3D),
shipments with dispatch, delivery and proof of delivery, delivery calendar.

**Finance** — receivables and collections (aging, cheques register), payments,
FX rates, returned scrap.

**ERP & data** — ERP sales orders (imported), Smart Import with downloadable
templates, data-quality review, reconciliation, documents.

**Administration** — users, roles and permissions, country access, pricing,
capacity rates, templates, audit trail, client portal access, and **System**
(email status and test, recent emails, backup status).

**Automation running in the background (worker)**

- Alerts every 10 minutes: overdue payments (to the salesperson and their
  manager), complaints past their stage deadline, production at risk, late
  deliveries, asking for feedback after delivery, quotations about to expire
  (and marking them expired), failed or missing backups (to administrators).
- Each person's new notifications gathered into one email.
- Official documents (quotation PDF, order confirmation PDF), imports, exports.

Roles seeded: `SYSTEM_ADMIN`, `SALES_MANAGER`, `SALES_REP`,
`LOGISTICS_COORDINATOR`, `OPERATIONS_ANALYST`, `FINANCE_ANALYST`,
`QUALITY_ENGINEER`, `R_AND_D`. Administrators can preview the menu as any
role ("View as") without changing their own permissions.

---

## 3. Business rules decided

These are decisions, not accidents — please keep them unless the business
changes them.

| Rule                                                                                                                                                                                                                                                                                            | Where it lives                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **No credit.** Any overdue amount, however small, alerts the salesperson and their manager (the person's manager in their profile; Sales Managers when none is set). Booking an order for a customer with overdue payments needs a written reason and `sales-orders.manage`, and notifies both. | `apps/worker/src/alert-rules.ts`, `apps/api/src/orders/orders.service.ts` |
| Quotations need an approval from someone other than the requester before they are sent. A sent quotation is never edited — it is superseded.                                                                                                                                                    | `quotation.service.ts`                                                    |
| A sent quotation the customer has not accepted is flagged 3 days before it expires and marked EXPIRED after.                                                                                                                                                                                    | `alert-scanner.ts`                                                        |
| Price floors are enforced by the server; overrides need permission and are audited.                                                                                                                                                                                                             | `apps/api/src/pricing`                                                    |
| Every change of state is audited (`audit_events`).                                                                                                                                                                                                                                              | everywhere                                                                |
| "Today" is the user's local date (Cairo), never UTC.                                                                                                                                                                                                                                            | `apps/web/src/lib/today.ts`                                               |
| Quotation rules (pricing, takeoff) follow the ACROW BOARD workbook; when the workbook and a document disagree, the workbook wins.                                                                                                                                                               | `apps/api/src/quotation`                                                  |

---

## 4. Running it

### Requirements

Docker Desktop (or Docker Engine), Node 24, pnpm 11.22 (`corepack enable`).

### Development (one machine)

```
docker compose up -d
```

| Service                                                | Address                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| Web app                                                | http://localhost:8080                                              |
| API                                                    | http://localhost:3000/api/v1 (proxied by the web app at `/api/v1`) |
| Mailpit (every email the system sends, caught locally) | http://localhost:8025                                              |
| PostgreSQL                                             | localhost:5432 (dev credentials in `docker-compose.yml`)           |
| Backups                                                | `./backups` (nightly at 02:00 Cairo, and once at first start)      |

Migrations run automatically (`migrate` service). After changing code, rebuild
the service you changed: `docker compose build api` (or `worker`, `web`), then
`docker compose up -d api`.

Create the first administrator (production):
`scripts\windows\create-local-admin.ps1` — it asks for the password; never put
passwords in files or scripts.

### Production (company server)

Two prepared ways, both running the same production stack:

- **Linux server (Ubuntu 24.04):** one command installs Docker, generates the
  secrets, starts the stack behind HTTPS and creates the administrator —
  [deploy/vps/README.md](../deploy/vps/README.md). Updates:
  `bash deploy/vps/update.sh` (takes a backup first).
- **Windows Server:** the scripts in `scripts\windows\` described below.

Either way:

- `docker-compose.production.yml` + `.env.production` (copy
  `.env.production.example`; every `REPLACE_WITH…` must be set, the file is
  never committed).
- Caddy serves HTTPS in front of the app (`Caddyfile`); set the real host
  name and certificate (it currently uses `abp-commercial.local` with an
  internal certificate).
- Operating scripts in `scripts\windows\`: `install`, `start`, `stop`,
  `restart`, `status`, `health-check`, `upgrade` (takes a verified backup
  first), `backup-abp`, `verify-backup`, `restore-abp`,
  `remove-development-data`.
- Must be off in production (already off in the example file):
  `ABP_TEST_AUTH_ENABLED`, `ABP_DEMO_SEED_ENABLED`,
  `ABP_LOCAL_ADMIN_BOOTSTRAP_ENABLED`; `ABP_SESSION_COOKIE_SECURE=true`.

**Email (Outlook) and backups:** step by step in
[guides/email-and-backups.md](guides/email-and-backups.md).
**Adding data with templates, changing document templates:**
[guides/adding-data-and-templates.md](guides/adding-data-and-templates.md).

---

## 5. How it is built

| Part        | Technology                                                            | Folder                                          |
| ----------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| Web app     | React 19, Vite, TanStack Query, Leaflet, ExcelJS                      | `apps/web`                                      |
| API         | NestJS 11 (REST, OpenAPI 3.1)                                         | `apps/api`                                      |
| Worker      | Node: durable jobs, outbox, alerts, email, PDFs (Playwright/Chromium) | `apps/worker`                                   |
| Database    | PostgreSQL (16 dev / 17 prod), Prisma 7.9                             | `packages/database`                             |
| Contract    | OpenAPI → generated typed client                                      | `docs/contracts/openapi`, `packages/api-client` |
| Permissions | shared constants                                                      | `packages/contracts`                            |
| Backups     | postgres image + shell script                                         | `scripts/docker/backup`                         |

Principles:

- **Contract first.** An endpoint starts in `docs/contracts/openapi`
  (path + schema, registered in `openapi.yaml`), then
  `node scripts/generate-api-contract-artifacts.mjs --write` and
  `node scripts/generate-frontend-operation-catalog.mjs`. Tests count the
  operations (326) and screens (82); update them when adding one.
- **The server is the authority** for permissions, prices and states; the
  web app only reflects them. Writes take an `Idempotency-Key`; updates use
  row versions (412 on a stale write).
- **Migrations** live in `packages/database/prisma/migrations`; a fresh
  database applies all of them with `prisma migrate deploy` (verified).
- **A new screen** is registered in `apps/web/src/app/screen-registry.ts`,
  `App.tsx` (route and sidebar group), `screen-purpose.ts` and
  `role-route-matrix.ts`.

### Checks

```
corepack pnpm --filter web exec vitest run src --fileParallelism=false   # 488 tests
corepack pnpm --filter api exec vitest run src --fileParallelism=false   # 265 tests
corepack pnpm --filter worker exec vitest run                            # 53 tests
npx tsc --noEmit -p tsconfig.json        # in apps/web, apps/api, apps/worker
npx eslint <files> --max-warnings 0
```

Database integration tests run against a separate database:
`TEST_DATABASE_URL=postgresql://abp:abp@127.0.0.1:5432/abp_test?schema=public`
(apply migrations to `abp_test` first; never point it at a live database).

The full gate the CI runs is `corepack pnpm verify` (format, lint, types,
tests, contract drift, build and the release proofs).

### CI on GitHub

| Workflow              | What it does                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify.yml`          | Install, migrations on PostgreSQL, `pnpm verify`, platform and customer proofs.                                                                                                                                       |
| `security.yml`        | `pnpm audit` (high and above), Gitleaks secret scan, the security proof, CodeQL. Four advisories in mobile-app development tools are ignored on purpose in `pnpm-workspace.yaml`; none reaches the production images. |
| `container-build.yml` | Builds the three Docker images.                                                                                                                                                                                       |
| `deploy.yml`          | Azure deployment from the original cloud design; manual and not used.                                                                                                                                                 |

---

## 6. What is still to do

### Before people use it (must)

1. **Server and HTTPS.** Install on the company server with the production
   compose file, a real host name and certificate, and the firewall open only
   for 443 (and 80, which redirects to it).
2. **Email.** Configure Outlook — Microsoft 365 through Graph, or the company
   Exchange over SMTP (guide above). Then _Administration → System → Send me a
   test email_.
3. **Second backup location.** Set `ABP_BACKUP_OFFSITE_DIR` to another disk or
   network share and run `verify-backup.ps1` once to see a restore succeed.
4. **Real users and data.** Create the administrator, the users and their
   roles and managers (managers matter: overdue alerts go to them). Remove the
   demonstration data (`remove-development-data.ps1`) and load real
   customers, products and ERP orders with the import templates.
5. **CI.** Check that `verify` and `security` are green on `main` after this
   handover and fix them if not.
6. **Health check.** Add an uptime check on `https://<host>/api/v1/health/ready`.
7. **Formal sign-off.** `docs/governance/step-12-release-gates.json` tracks 16
   release gates. Five pass (OpenAPI, BI, authorization, data integrity,
   migrations); the rest need the production environment, real users (UAT,
   access certification, training), a performance measurement there, and a
   cutover and rollback rehearsal (`docs/runbooks/`). The final Go/No-Go
   follows them.

### Next features (business)

| Feature                      | Notes                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Live ERP connection          | Today ERP orders arrive by file import. A direct link needs the ERP's interface details.                                           |
| Sales commissions            | Targets exist per person; commission rules are not built.                                                                          |
| Field visits                 | Logging a site visit with time and place.                                                                                          |
| Scheduled management reports | A weekly summary emailed to management (email is now available).                                                                   |
| Customer portal              | Screens and access administration exist; no customer has been given access yet — review what customers should see before enabling. |
| E-invoicing                  | Belongs to the ERP, not the CRM.                                                                                                   |

### Technical debt (known)

- 24 response schemas of the order-to-cash screens (customer orders,
  receivables, work orders, shipments, feedback, map, system, complaint,
  import job) declare their fields but still allow extra ones
  (`additionalProperties: true`). `scripts/check-api-contract.mjs` holds the
  count at 24 so it can only go down; close them one by one.
- The DevOps proof needs the Bicep CLI (`.tmp/tools/bicep`); CI downloads it,
  a developer machine needs it only to run that proof locally.
- One web test (`CustomerPage.test.tsx`) can time out when the machine is under
  heavy load; it passes on its own.
- Demonstration data: QT-2026-0012/0013 are marked READY without having been
  prepared, and QT-2026-0014/0015 are EXPIRED with a future date. Real data
  replaces them.
- `docs/runbooks/` was written for a cloud design; the self-hosted procedure
  is in `docs/guides/email-and-backups.md`.
- `main` is the current system and the only branch; work on a branch and merge
  through a pull request once CI is green.
- `infra/` (Azure Bicep) and `render.yaml` (staging blueprint) come from the
  original cloud design and are not used by the self-hosted setup.
- `apps/desktop` (Electron) and `apps/mobile` (Expo) are optional and not
  needed to run the system; the web app works on phones.

### Developer machine note

If Docker Desktop on Windows refuses to start with an error about
`sailor-ingest.sock`, close Docker, run `wsl --shutdown`, rename
`%LOCALAPPDATA%\Docker\run` to `run.old`, and start Docker again. **Never** use
"Reset to factory defaults": it deletes the database volumes.

---

## 7. Where to look

| Question                             | File                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| What every screen is for             | `apps/web/src/app/screen-purpose.ts`                                              |
| Which role sees which screen         | `apps/web/src/app/role-route-matrix.ts`                                           |
| Every endpoint                       | `docs/contracts/openapi/openapi.yaml`, `docs/contracts/api-inventory.md`          |
| Database schema                      | `packages/database/prisma/schema.prisma`                                          |
| Alerts and their rules               | `apps/worker/src/alert-rules.ts`                                                  |
| Email                                | `apps/worker/src/mail/`                                                           |
| Release gates and sign-off           | `docs/governance/step-12-release-gates.json`, `docs/governance/final-go-no-go.md` |
| Backup, restore, rollback, incidents | `docs/guides/email-and-backups.md`, `docs/runbooks/`                              |
| Change history                       | `git log` — every commit explains what changed and why                            |

---

## 8. Access and secrets

- No password, key or token is in the repository. `.env`, `.env.production`
  and `.abp-admin` are created on the machine that runs the system and are
  ignored by Git; Gitleaks scans every push.
- The MFA key in `docker-compose.yml` is for local development only; the
  production setup generates its own.
- On taking over: add the IT team to the GitHub repository (or move it to the
  company's GitHub organisation), and rotate any access token issued before.
- `.github/CODEOWNERS` names placeholder teams (`@technical-owner`,
  `@security-owner`, `@data-owner`); replace them with the real GitHub users
  or teams who must review those folders.
