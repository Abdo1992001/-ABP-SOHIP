#!/usr/bin/env bash
# Dump the database to /opt/abp-backups, keeping the last 14 days.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
. deploy/vps/lib.sh
dir="${ABP_BACKUP_DIR:-/opt/abp-backups}"
mkdir -p "$dir"
file="$dir/abp-$(date +%Y%m%d-%H%M%S).dump"
compose exec -T db pg_dump -U abp -d abp -Fc > "$file"
find "$dir" -name 'abp-*.dump' -mtime +14 -delete
echo "Backup written: $file"
