# ABP Commercial System

The commercial system of ACROW Building Products: customers, projects,
opportunities, quotations, orders, production, logistics, collections and
customer feedback in one place — from manual work to connected commercial
operations.

**Start here: [docs/HANDOVER.md](docs/HANDOVER.md)** — the concept, what the
system does, how to run it, how it is built, the business rules that were
decided, and what is still to do.

## Run it on one machine

Requirements: Docker Desktop, Node 24, pnpm 11.22 (`corepack enable`).

```
docker compose up -d
```

- App: http://localhost:8080
- Emails the system sends (caught locally, never delivered): http://localhost:8025
- Backups: `./backups`

## Guides

- [Handover](docs/HANDOVER.md)
- [Email (Outlook) and backups](docs/guides/email-and-backups.md)
- [Adding data with templates, changing document templates](docs/guides/adding-data-and-templates.md)
- API contract: [docs/contracts/openapi/openapi.yaml](docs/contracts/openapi/openapi.yaml)

## Layout

| Folder                                      | What                                                              |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `apps/web`                                  | Web app (React)                                                   |
| `apps/api`                                  | API (NestJS)                                                      |
| `apps/worker`                               | Background jobs, alerts, email, documents                         |
| `packages/database`                         | PostgreSQL schema and migrations (Prisma)                         |
| `packages/contracts`, `packages/api-client` | Permissions and the generated API client                          |
| `docs`                                      | Handover, guides, contract, architecture                          |
| `scripts`                                   | Code generation, Docker backup service, Windows operating scripts |
| `deploy/vps`                                | One-command installation on a Linux server                        |

Never commit `.env`, `.env.production` or any password; they are ignored by
`.gitignore`.
