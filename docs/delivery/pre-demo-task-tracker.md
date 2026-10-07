# ABP Commercial System — Pre-Demo Delivery Status

Updated: 2026-09-06

## Completed release gates

- [x] Light and dark themes cover the shell, dashboard, cards, tables, forms,
      Customer 360, quotations, reports, tabs, and action bars.
- [x] ESLint passes across the repository with zero errors and zero warnings.
- [x] Prettier passes across the repository with no differences.
- [x] TypeScript passes for all nine workspace projects.
- [x] Web, API, database, and authorization tests pass.
- [x] Production builds pass for web, API, worker, desktop, mobile, and packages.
- [x] Vendor chunks are separated; the lazy Three.js route is isolated and the
      production build has no chunk-size warning.
- [x] University demo data is available without Docker through `pnpm demo:api`:
      10 customers, 10 opportunities, 6 quotations, and 8 activities.
- [x] The governed database seed contains 20 customers, 25 opportunities,
      15 quotations, 50 activities, and the complete supporting data set.
- [x] Prisma migrations and idempotent seed run against the local PostgreSQL
      service with the $5,000,000 target and $1,875,000 achieved amount.
- [x] Customer 360 returns contacts, opportunities, quotations, activities,
      and ERP sync status through the real API and UI.
- [x] ERP outbound sync worker scans pending orders, marks them synced, and
      records durable jobs with mock ERP IDs.
- [x] API and worker integration suite passes with 22/22 tests.
- [x] Docker Compose provisions PostgreSQL plus the isolated `abp_test`
      database for integration tests.
- [x] Customer journey verified: create customer, open Customer 360 with
      11 tabs, add contact, create linked opportunity, and create linked quotation.
- [x] Priority UI QA passes for Dashboard at 1440/1280/768, Customers,
      Opportunities, Quotation Studio, Activities, Calendar, Reports, Admin,
      Finance, Arabic RTL, and mobile at 375px with no horizontal overflow.
- [x] Demo identity is Mohamed Ramadan with the Sales Manager role.

## Demo commands

Run these in separate terminals from the repository root:

```powershell
corepack pnpm demo:api
corepack pnpm demo:web
```

Open `http://127.0.0.1:5173/`.

## Release history

- Base pre-demo commit: `2701626`
- Release tag: `v1.0.0-demo`

## Remaining production gates

Production-only gates such as Entra ID, Key Vault, private networking, UAT
sign-off, mobile release, load testing, backup rehearsal, and production
access certification remain post-demo work.
