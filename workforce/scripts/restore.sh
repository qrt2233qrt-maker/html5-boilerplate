#!/bin/sh
# Restores a backup made by backup.sh into an EMPTY database.
#
#   scripts/restore.sh backups/daily/workforce-20261002-023000.dump [uploads-….tar.gz]
#
# Connection comes from the PG* variables or DATABASE_URL, as for backup.sh.
# Restore into a new database first and check it before pointing the app at
# it; this script refuses to touch a database that already has tables.
set -eu

dump=${1:?usage: restore.sh <workforce-….dump> [uploads-….tar.gz]}
uploads=${2:-}
UPLOAD_DIR=${UPLOAD_DIR:-./data/uploads}
db_args=""
[ -n "${DATABASE_URL:-}" ] && db_args="$DATABASE_URL"

# shellcheck disable=SC2086
tables=$(psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" $db_args)
if [ "$tables" != "0" ]; then
  echo "The target database already has $tables tables. Restore into an empty database." >&2
  exit 1
fi

# shellcheck disable=SC2086
if [ -n "$db_args" ]; then
  pg_restore --no-owner --exit-on-error --dbname="$db_args" "$dump"
else
  pg_restore --no-owner --exit-on-error --dbname="${PGDATABASE:?set PGDATABASE}" "$dump"
fi

if [ -n "$uploads" ]; then
  mkdir -p "$UPLOAD_DIR"
  tar -xzf "$uploads" -C "$UPLOAD_DIR"
fi
echo "Restored $dump${uploads:+ and $uploads}"
