# Email and backups

For whoever runs the server. Both are checked from **Administration → System**:
it shows whether email works (with a "Send me a test email" button), the last
emails and what became of each, and the last backup with its restore check.

## Email through Outlook

The system sends three kinds of email, all from one company mailbox:

- **Quotations** — from the quotation's _Send quotation_ screen, with the
  official PDF attached. Replies go to the salesperson who sent it.
- **Notifications** — each person's new notifications, gathered into one email
  about a minute after they arrive. Everyone can turn this off, and choose the
  email language, under _Settings → Notifications_.
- **Undelivered notices** — if a quotation email cannot be delivered after
  retries (1, 5, 15, 60 and 180 minutes), the sender is told in the app.

Until email is set up, quotations are recorded as sent by hand and
notifications stay in the app. Nothing breaks.

### Microsoft 365 (Outlook online) — `ABP_MAIL_PROVIDER=GRAPH`

Microsoft is retiring password sign-in for SMTP on Microsoft 365, so the system
sends through Microsoft Graph with an app registration instead of a password.

1. In the Microsoft Entra admin center: **App registrations → New
   registration**, name it "ABP Commercial", single tenant.
2. **API permissions → Add → Microsoft Graph → Application permissions →
   Mail.Send**, then **Grant admin consent**.
3. **Certificates & secrets → New client secret**. Copy the value now; it is
   shown once. Note its expiry date and renew it before then.
4. Recommended: limit the app to the one mailbox it sends from (Exchange
   Online _RBAC for Applications_, or an _Application Access Policy_), so it
   cannot send as anyone else.
5. Put these in `.env.production` and restart (`scripts\windows\restart-abp.ps1`):

```
ABP_MAIL_PROVIDER=GRAPH
ABP_MAIL_SENDER=crm@your-company.com
ABP_MAIL_GRAPH_TENANT_ID=<Directory (tenant) ID>
ABP_MAIL_GRAPH_CLIENT_ID=<Application (client) ID>
ABP_MAIL_GRAPH_CLIENT_SECRET=<the secret value>
ABP_PUBLIC_APP_URL=https://<the address people open the system at>
```

Attachments must be under 3 MB each with this method; quotation PDFs are far
smaller.

### Exchange on your own server — `ABP_MAIL_PROVIDER=SMTP`

```
ABP_MAIL_PROVIDER=SMTP
ABP_MAIL_SENDER=crm@your-company.com
ABP_MAIL_SMTP_HOST=mail.your-company.local
ABP_MAIL_SMTP_PORT=587
ABP_MAIL_SMTP_SECURE=false
ABP_MAIL_SMTP_USER=crm@your-company.com
ABP_MAIL_SMTP_PASSWORD=<the mailbox password>
ABP_PUBLIC_APP_URL=https://<the address people open the system at>
```

Port 587 uses STARTTLS; for port 465 set `ABP_MAIL_SMTP_SECURE=true`. The
mailbox must be allowed to send (authenticated SMTP submission enabled).

### Check it

Administration → System → **Send me a test email**. The _Recent emails_ table
shows it as _Sent_, or the reason it was not.

### On a developer machine

`docker compose up` starts **Mailpit**: every email the system sends is caught
at <http://localhost:8025> and never leaves the machine. To try real Outlook
locally, put the settings above in a `.env` file next to `docker-compose.yml`.

## Backups

The `backup` service backs up every night at `ABP_BACKUP_HOUR` (Cairo time,
default 2 AM), and once straight away when it first starts:

1. `pg_dump` writes the database to `abp.dump` inside the container.
2. Every uploaded document and generated PDF goes into `documents.tar.gz`.
3. The dump is **restored into a scratch database** and counted. A backup that
   does not restore is reported as failed, not kept.
4. Checksums go in `SHA256SUMS`, and the result in the status file the System
   page reads.

Backups are folders named like `20261005-020000` in `ABP_BACKUP_DIR` (default
`.\backups`). The newest 14 are kept, plus one per month for 6 months
(`ABP_BACKUP_KEEP_DAILY`, `ABP_BACKUP_KEEP_MONTHLY`).

**Keep a second copy somewhere else.** A backup on the same disk as the
database is lost with it. Set `ABP_BACKUP_OFFSITE_DIR` to a second disk or a
mapped network share and every backup is copied there too.

| Task                    | Command (PowerShell, production)                                              |
| ----------------------- | ----------------------------------------------------------------------------- |
| Back up now             | `scripts\windows\backup-abp.ps1`                                              |
| Check a backup restores | `scripts\windows\verify-backup.ps1 -BackupName 20261005-020000`               |
| Put a backup back       | `scripts\windows\restore-abp.ps1 -BackupName 20261005-020000 -ConfirmRestore` |

Restoring stops the application, checks the backup restores into a scratch
database first (if not, the live data is not touched), replaces the database
and documents, and starts the application again. Upgrading
(`scripts\windows\upgrade-abp.ps1`) now takes a verified backup first and stops
if it fails.

If a backup fails or is more than 36 hours old, the System page shows it in
amber with the reason.
