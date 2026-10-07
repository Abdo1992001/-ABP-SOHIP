# Backup and restore

> **Self-hosted installation:** this runbook describes a cloud (Azure) design. For the self-hosted system the procedure is in [../guides/email-and-backups.md](../guides/email-and-backups.md) — nightly backups restored into a scratch database, `scripts/windows/backup-abp.ps1`, `verify-backup.ps1` and `restore-abp.ps1`.

Engineering design: Azure PostgreSQL PITR retention 14 days, RPO at most 15 minutes, RTO at most 4 hours; daily logical/managed retention 35 days and monthly retention 12 months. Formal policy is DEP-007.

1. Confirm backup/PITR freshness and alert state. Record source server, target point, encryption/key state, and change authority.
2. Always restore first to an isolated private target with a distinct explicit name. Never overwrite the source during validation.
3. Verify PostgreSQL 17, completed Prisma migrations, table/index/constraint counts, representative row counts, audit history, documents/object references, ERP lineage, DQ and analytics reconciliation.
4. Start an isolated application revision against the restored target and run smoke/authz/read-only checks.
5. Record restore duration and compare with RTO. Delete the isolated target only after evidence retention approval, using its exact validated resource ID.
6. Production promotion or PITR cutover is Step-12/incident-authority work. The local executable proof is `pnpm proof:backup`.
