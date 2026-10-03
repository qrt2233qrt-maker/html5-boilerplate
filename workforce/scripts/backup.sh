#!/bin/sh
# Backs up the database and the private uploads, checks the dump can be
# read, and prunes old copies.
#
#   Connection: the usual PG* variables (PGHOST, PGUSER, PGPASSWORD,
#               PGDATABASE) or DATABASE_URL.
#   UPLOAD_DIR  uploads to include (default ./data/uploads)
#   BACKUP_DIR  where to write (default ./backups)
#   KEEP_DAILY  daily copies to keep (default 14)
#   KEEP_MONTHLY monthly copies to keep (default 12; the first backup
#               taken each month is kept as that month's copy)
#
# Copy BACKUP_DIR off the server too (another disk, object storage):
# a backup on the same machine doesn't survive losing the machine.
set -eu

BACKUP_DIR=${BACKUP_DIR:-./backups}
UPLOAD_DIR=${UPLOAD_DIR:-./data/uploads}
KEEP_DAILY=${KEEP_DAILY:-14}
KEEP_MONTHLY=${KEEP_MONTHLY:-12}
stamp=$(date -u +%Y%m%d-%H%M%S)
month=$(date -u +%Y-%m)
daily="$BACKUP_DIR/daily"
monthly="$BACKUP_DIR/monthly"
mkdir -p "$daily" "$monthly"
umask 077

db_args=""
[ -n "${DATABASE_URL:-}" ] && db_args="$DATABASE_URL"

# 1. Database: custom format, compressed, consistent snapshot.
dump="$daily/workforce-$stamp.dump"
# shellcheck disable=SC2086
pg_dump --format=custom --no-owner --file="$dump.part" $db_args
# 2. Check the dump is readable before trusting it.
pg_restore --list "$dump.part" > /dev/null
mv "$dump.part" "$dump"

# 3. Uploads (receipts, contracts): they are not in the database.
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$daily/uploads-$stamp.tar.gz.part" -C "$UPLOAD_DIR" .
  mv "$daily/uploads-$stamp.tar.gz.part" "$daily/uploads-$stamp.tar.gz"
fi

# 4. Keep the first backup of each month for longer.
if ! ls "$monthly"/workforce-"$(date -u +%Y%m)"*.dump > /dev/null 2>&1; then
  cp "$dump" "$monthly/"
  [ -f "$daily/uploads-$stamp.tar.gz" ] && cp "$daily/uploads-$stamp.tar.gz" "$monthly/"
fi

# 5. Retention: newest first, drop the rest.
prune() { ls -1t "$1"/$2 2> /dev/null | tail -n +"$(($3 + 1))" | while read -r f; do rm -f "$f"; done; }
prune "$daily" 'workforce-*.dump' "$KEEP_DAILY"
prune "$daily" 'uploads-*.tar.gz' "$KEEP_DAILY"
prune "$monthly" 'workforce-*.dump' "$KEEP_MONTHLY"
prune "$monthly" 'uploads-*.tar.gz' "$KEEP_MONTHLY"

echo "Backup $stamp written to $daily ($month)"
