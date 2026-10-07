# Installing ABP on a Linux server

ABP runs as several containers (database, migrations, API, worker, web, an
HTTPS proxy and the backup service). These scripts install the same Docker
stack that runs in development on one Ubuntu server, with HTTPS.

For a Windows Server installation use `scripts\windows\` instead (see
[docs/HANDOVER.md](../../docs/HANDOVER.md)).

## 1. The server

Ubuntu 24.04, **4 GB RAM or more**, 40 GB disk or more, ports 80 and 443
reachable by the users. Note the server's address and, if the system will have
a company host name (for example `crm.<company domain>`), point its DNS A
record at the server first.

## 2. Access to the code

The repository is private, so the server needs a read-only key to download it:
a GitHub **fine-grained token** limited to this repository with **Contents:
Read-only** (or a deploy key, if the repository is moved to the company's
GitHub organisation).

## 3. Install (one command, as root)

```
export GITHUB_TOKEN=TOKEN
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://raw.githubusercontent.com/Abdo1992001/-ABP-SOHIP/main/deploy/vps/install.sh | ABP_DOMAIN=crm.example.com bash
```

Without `ABP_DOMAIN` the address is `https://<ip-with-dashes>.sslip.io`, which
is useful for a first test only.

The script installs Docker, generates every secret into `.env.production`
(readable by root only), builds and starts the production stack, opens ports
80 and 443 in the server's own firewall, and creates the administrator
`admin`. The generated password is kept in `/opt/abp/.abp-admin`; the first
sign-in asks for a new password and MFA.

After installing, set the email settings (Outlook) and the second backup
location in `/opt/abp/.env.production` as described in
[docs/guides/email-and-backups.md](../../docs/guides/email-and-backups.md),
then run `bash deploy/vps/update.sh`.

## 4. Moving data from an existing installation (optional)

Take a dump on the existing installation
(`pg_dump -U abp -d abp -Fc -f abp.dump` inside its `db` container), copy it
to the server, then:

```
cd /opt/abp && bash deploy/vps/restore.sh /root/abp.dump
```

A restore resets the `admin` password to the one in `/opt/abp/.abp-admin`.

## Updating after new changes on GitHub

```
cd /opt/abp && bash deploy/vps/update.sh
```

It backs up the database, pulls `main` and rebuilds. Data is kept.

## Backups

The `backup` service takes a verified nightly backup (database and documents)
and can copy it to a second location; `deploy/vps/backup.sh` also writes a
nightly dump to `/opt/abp-backups` (last 14 days). Run one by hand with
`bash deploy/vps/backup.sh`.

## Stopping

`cd /opt/abp && docker compose --env-file .env.production -f docker-compose.production.yml -f deploy/vps/compose.vps.yml down`
stops the system and keeps the data. Deleting the server deletes everything,
so copy a backup off it first.
