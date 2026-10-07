#!/bin/sh
# ABP backups, run inside the postgres image next to the database.
#
#   backup.sh service   take one every night at ABP_BACKUP_HOUR (Cairo time)
#   backup.sh now       take one now
#   backup.sh verify <name>          restore <name> into a scratch database
#   backup.sh restore <name> --confirm   put <name> back (stop api/worker first)
#   backup.sh list      the backups kept
#
# A backup is the database (pg_dump custom format, written by pg_dump itself,
# never piped through anything that could mangle it) and every uploaded
# document and generated PDF. Each one is restored into a scratch database
# before it counts: a backup nobody has restored is a hope, not a backup.
set -u

BACKUPS=/backups
STATUS=/status/latest.json
OBJECTS=/objects
KEEP_DAILY=${ABP_BACKUP_KEEP_DAILY:-14}
KEEP_MONTHLY=${ABP_BACKUP_KEEP_MONTHLY:-6}
HOUR=${ABP_BACKUP_HOUR:-2}
OFFSITE=${ABP_BACKUP_OFFSITE_DIR:-}
SCRATCH=abp_restore_check

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') backup: $*"; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '; }
bytes() { [ -f "$1" ] && wc -c < "$1" | tr -d ' ' || echo 0; }

# Seconds until the next ABP_BACKUP_HOUR:00, local time.
seconds_to_next_run() {
  now=$(date +%s)
  today=$(date +%Y-%m-%d)
  hh=$(printf '%02d' "$HOUR")
  target=$(date -d "$today $hh:00:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

next_run_iso() {
  date -d "@$(( $(date +%s) + $(seconds_to_next_run) ))" '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || echo ""
}

# Restore a dump into a scratch database and count what came back.
# Prints "tables customers" on success.
verify_dump() {
  dump=$1
  dropdb --if-exists "$SCRATCH" >/dev/null 2>&1
  createdb "$SCRATCH" || return 1
  if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH" "$dump" >/dev/null 2>/tmp/restore.err; then
    dropdb --if-exists "$SCRATCH" >/dev/null 2>&1
    return 1
  fi
  tables=$(psql -d "$SCRATCH" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
  customers=$(psql -d "$SCRATCH" -Atc "select count(*) from accounts" 2>/dev/null || echo 0)
  dropdb --if-exists "$SCRATCH" >/dev/null 2>&1
  [ "${tables:-0}" -gt 20 ] || return 1
  echo "$tables $customers"
}

# Keep the newest KEEP_DAILY, plus the oldest backup of each of the last
# KEEP_MONTHLY months; delete the rest. Only ever touches YYYYMMDD-HHMMSS
# folders this script made.
prune() {
  local root=$1 entry month kept=0 months="" monthly=0
  for entry in $(ls -1 "$root" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r); do
    month=$(echo "$entry" | cut -c1-6)
    if [ "$kept" -lt "$KEEP_DAILY" ]; then
      kept=$((kept + 1)); months="$months $month"; continue
    fi
    case " $months " in
      *" $month "*) rm -rf "${root:?}/$entry" ;;
      *)
        if [ "$monthly" -lt "$KEEP_MONTHLY" ]; then
          monthly=$((monthly + 1)); months="$months $month"
        else
          rm -rf "${root:?}/$entry"
        fi ;;
    esac
  done
}

write_status() {
  mkdir -p "$(dirname "$STATUS")"
  printf '%s\n' "$1" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

take_backup() {
  name=$(date +%Y%m%d-%H%M%S)
  dir=$BACKUPS/$name
  work=$BACKUPS/.$name.partial
  started=$(date '+%Y-%m-%dT%H:%M:%S%z')
  error=""
  mkdir -p "$work"
  log "starting $name"

  if ! pg_dump -Fc -f "$work/abp.dump" 2>/tmp/dump.err; then
    error="Database dump failed: $(head -c 300 /tmp/dump.err)"
  fi
  if [ -d "$OBJECTS" ]; then
    tar -czf "$work/documents.tar.gz" -C "$OBJECTS" . 2>/tmp/tar.err \
      || error="${error:+$error; }Documents archive failed: $(head -c 200 /tmp/tar.err)"
  fi

  verified_ok=false; tables=0; customers=0
  if [ -z "$error" ]; then
    if result=$(verify_dump "$work/abp.dump"); then
      verified_ok=true
      tables=${result% *}; customers=${result#* }
    else
      error="The backup did not restore: $(head -c 300 /tmp/restore.err 2>/dev/null)"
    fi
  fi

  offsite=""
  if [ -z "$error" ]; then
    (cd "$work" && sha256sum abp.dump documents.tar.gz > SHA256SUMS 2>/dev/null || sha256sum abp.dump > SHA256SUMS)
    mv "$work" "$dir"
    prune "$BACKUPS"
    if [ -n "$OFFSITE" ]; then
      if mkdir -p "$OFFSITE" 2>/dev/null && cp -r "$dir" "$OFFSITE/" 2>/tmp/copy.err; then
        prune "$OFFSITE"
        offsite=$OFFSITE
      else
        error="Second copy to $OFFSITE failed: $(head -c 200 /tmp/copy.err)"
      fi
    fi
  else
    rm -rf "$work"
  fi

  kept=$(ls -1 "$BACKUPS" 2>/dev/null | grep -cE '^[0-9]{8}-[0-9]{6}$')
  ok=false; [ -z "$error" ] && ok=true
  write_status "{\"name\":\"$name\",\"ok\":$ok,\"startedAt\":\"$started\",\"finishedAt\":\"$(date '+%Y-%m-%dT%H:%M:%S%z')\",\"database\":{\"bytes\":$(bytes "$dir/abp.dump")},\"documents\":{\"bytes\":$(bytes "$dir/documents.tar.gz")},\"verified\":{\"ok\":$verified_ok,\"tables\":$tables,\"customers\":$customers},\"keptCopies\":$kept,\"offsiteCopy\":\"$(json_escape "$offsite")\",\"nextRunAt\":\"$(next_run_iso)\",\"error\":\"$(json_escape "$error")\"}"
  if [ "$ok" = true ]; then log "done $name ($tables tables, $customers customers restored)"; else log "FAILED $name: $error"; fi
  [ "$ok" = true ]
}

case "${1:-service}" in
  now)
    take_backup ;;
  list)
    ls -1 "$BACKUPS" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r ;;
  verify)
    name=${2:?name of the backup to verify}
    (cd "$BACKUPS/$name" && sha256sum -c SHA256SUMS) || exit 1
    result=$(verify_dump "$BACKUPS/$name/abp.dump") || { log "$name did not restore"; exit 1; }
    log "$name restores: ${result% *} tables, ${result#* } customers" ;;
  restore)
    name=${2:?name of the backup to restore}
    [ "${3:-}" = "--confirm" ] || { echo "Restoring replaces the live data. Run again with --confirm."; exit 2; }
    (cd "$BACKUPS/$name" && sha256sum -c SHA256SUMS) || exit 1
    verify_dump "$BACKUPS/$name/abp.dump" >/dev/null || { log "$name does not restore; the live data was not touched"; exit 1; }
    log "restoring $name into the live database"
    pg_restore --clean --if-exists --no-owner --no-privileges -d "${PGDATABASE:-abp}" "$BACKUPS/$name/abp.dump" || exit 1
    if [ -f "$BACKUPS/$name/documents.tar.gz" ]; then
      log "restoring documents"
      find "$OBJECTS" -mindepth 1 -delete && tar -xzf "$BACKUPS/$name/documents.tar.gz" -C "$OBJECTS" || exit 1
    fi
    log "restored $name" ;;
  service)
    log "service started: nightly at $HOUR:00 ($(date +%Z)), keeping $KEEP_DAILY daily and $KEEP_MONTHLY monthly"
    # The first time, or after a long stop, take one straight away.
    latest=$(ls -1 "$BACKUPS" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | head -n 1)
    if [ -z "$latest" ] || [ ! -f "$STATUS" ] || [ -n "$(find "$BACKUPS/$latest" -maxdepth 0 -mmin +1500 2>/dev/null)" ]; then
      take_backup
    fi
    while true; do
      sleep "$(seconds_to_next_run)"
      take_backup
      sleep 60
    done ;;
  *)
    echo "usage: backup.sh service|now|list|verify <name>|restore <name> --confirm"; exit 2 ;;
esac
