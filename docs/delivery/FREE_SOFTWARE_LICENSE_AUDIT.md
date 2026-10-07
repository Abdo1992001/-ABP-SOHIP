# Free Software License Audit

This is a repository-level runtime audit. The authoritative package inventory is generated in `docs/evidence/step-11-license-inventory.json`; transitive development tooling is not a mandatory production service.

| Component                 | Purpose                         | License class         | Runtime         | Internet required                       | Recurring cost | Decision |
| ------------------------- | ------------------------------- | --------------------- | --------------- | --------------------------------------- | -------------: | -------- |
| React / Vite / TypeScript | web UI and build                | permissive OSS        | yes/build       | no after build                          |             $0 | approved |
| NestJS / Express          | API                             | MIT OSS               | yes             | no                                      |             $0 | approved |
| Prisma / PostgreSQL       | ORM and database                | Apache/PostgreSQL OSS | yes             | no                                      |             $0 | approved |
| Playwright / Chromium     | official PDF and browser checks | Apache/OSS browser    | worker/test     | no                                      |             $0 | approved |
| Nginx                     | static web serving              | BSD-2-Clause          | production web  | no                                      |             $0 | approved |
| Caddy                     | LAN reverse proxy/internal TLS  | Apache-2.0 OSS        | production edge | no public Internet required             |             $0 | approved |
| ExcelJS / CSV tooling     | import/export                   | MIT/OSS               | API             | no                                      |             $0 | approved |
| Lucide React              | icons                           | ISC OSS               | web             | no                                      |             $0 | approved |
| Docker Engine/Compose     | local packaging                 | Apache-2.0/OSS        | infrastructure  | no registry required after images exist |             $0 | approved |

The generated inventory must be reviewed whenever dependencies change. No paid runtime license or SaaS account is required by the self-hosted profile.

Required cost result: recurring software cost `$0`; mandatory paid services `0`; mandatory cloud services `0`; mandatory paid APIs `0`.
