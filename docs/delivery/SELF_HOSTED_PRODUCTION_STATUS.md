# Self-Hosted Production Status

## Implemented in this change

- PostgreSQL 17 production Compose profile with persistent volume.
- Caddy reverse proxy with internal TLS for `abp-commercial.local`.
- Static web container through Nginx; no Vite server in production profile.
- Local protected storage volume for documents, quotation PDFs, imports, exports, profile images and attachments.
- Local backup/restore PowerShell scaffolding using `pg_dump`, Robocopy and SHA-256 checksums.
- Local startup/status/health/upgrade/rollback command scaffolding.
- Production configuration branch that rejects wildcard/insecure origins, demo seed, test auth and non-local secret configuration.
- Zero-subscription cost, license, integration and data-flow documentation.

## Verified in the production profile

- Local username/password authentication, Argon2id hashing, TOTP enrollment/verification and recovery-code flow were exercised against the running stack.
- PostgreSQL 17.11 ran with 40 applied migrations and zero Prisma schema drift.
- Caddy internal HTTPS, HTTP-to-HTTPS redirect, API readiness, web serving, worker readiness and restart recovery were exercised.
- Backup/restore proof passed against the PostgreSQL 17 container and production business tables remain empty after smoke cleanup.

## Remaining implementation blockers

- The complete offline Playwright journey and the requested 1366/tablet/mobile/RTL visual matrix are still not automated.
- `pnpm audit --prod --audit-level high` still reports two high and eight moderate advisories in mobile build tooling (`image-size` through Metro); the production API/web images do not include the mobile workspace.
- The largest web chunk is the lazy Three.js vendor chunk at about 681 kB minified; it is below the configured 700 kB warning threshold but above the preferred 500 kB budget.
- External UAT, off-host backup retention and production access certification remain operational handover work.

The profile is running and smoke-verified, while the remaining items above are explicit acceptance work rather than unverified runtime claims.
