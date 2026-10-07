#!/usr/bin/env bash
# Replace the online database with a dump (e.g. one taken from your PC).
#   cd /opt/abp && bash deploy/vps/restore.sh /root/abp.dump
# The current online data is backed up first. Afterwards the administrator's
# password is set back to the one in .abp-admin.
set -euo pipefail
dump="${1:?Usage: restore.sh <file.dump>}"
[ -f "$dump" ] || { echo "No such file: $dump" >&2; exit 1; }
cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
. deploy/vps/lib.sh
set -a
# shellcheck disable=SC1091
. ./.abp-admin
set +a

bash deploy/vps/backup.sh
compose stop api worker web reverse-proxy
compose exec -T db psql -U abp -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS abp WITH (FORCE)" -c "CREATE DATABASE abp OWNER abp"
compose exec -T db pg_restore -U abp -d abp --no-owner --no-privileges < "$dump"
# Brings the restored data up to this version's schema, then starts everything.
compose up -d
compose exec -T -e "ABP_TARGET_USERNAME=${ABP_ADMIN_USERNAME}" \
  -e "ABP_ADMIN_PASSWORD=${ABP_ADMIN_PASSWORD}" \
  api node apps/api/dist/security/local-admin-cli.js reset-password
echo "Restored. Sign in as ${ABP_ADMIN_USERNAME} with the password in .abp-admin."
