# Zero-Subscription Cost Report

| Component         | Technology                           | Hosted where        | License            | Monthly subscription | Internet required? | Replacement if unavailable |
| ----------------- | ------------------------------------ | ------------------- | ------------------ | -------------------: | ------------------ | -------------------------- |
| Web               | React/Vite + Nginx                   | company server      | OSS                |                   $0 | no after build     | static Nginx files         |
| API               | NestJS/Node                          | company server      | MIT/OSS            |                   $0 | no                 | local Node runtime         |
| Worker            | TypeScript + PostgreSQL jobs         | company server      | OSS                |                   $0 | no                 | local worker process       |
| Database          | PostgreSQL 17                        | Docker/local server | PostgreSQL license |                   $0 | no                 | local PostgreSQL host      |
| Reverse proxy/TLS | Caddy `tls internal`                 | company server      | Apache-2.0         |                   $0 | no public Internet | Nginx + company CA         |
| Files             | protected local volumes              | company disk/NAS    | filesystem tools   |                   $0 | no                 | second disk/NAS            |
| PDF               | Playwright + pinned Chromium         | worker              | OSS                |                   $0 | no                 | local Chromium             |
| Analytics         | PostgreSQL aggregates + React charts | API/web             | OSS                |                   $0 | no                 | SQL/report endpoints       |
| Imports/exports   | ExcelJS/CSV/JSON                     | API                 | OSS                |                   $0 | no                 | local parsers              |
| Backup            | pg_dump + PowerShell/Robocopy        | second disk/NAS     | OS tools           |                   $0 | no                 | encrypted local archive    |
| Auth/MFA          | local session/TOTP target            | PostgreSQL/API      | OSS implementation |                   $0 | no                 | local authenticator app    |

**ABP core software subscription cost: `$0 / month`.** Required paid SaaS: `NONE`. Required paid cloud: `NONE`. Required paid authentication: `NONE`. Required paid database: `NONE`. Required paid analytics: `NONE`. Required paid storage: `NONE`.
