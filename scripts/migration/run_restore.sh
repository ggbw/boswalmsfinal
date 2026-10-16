#!/usr/bin/env bash
# Restores the Lovable Cloud export into an EMPTY Supabase project, copies the
# stored files, then compares row counts with the export.
#
# It refuses to run if the target already has app tables, so it can never
# overwrite data. Nothing is deleted anywhere.
#
# Usage: bash run_restore.sh <export.backup>
# Env file: C:/Users/user/.boswa-migration.env (see README.md)
set -euo pipefail

DUMP="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
PG=/c/Users/user/tools/pgsql/bin
WORK="${WORK_DIR:-/c/Users/user/boswa-migration-work}"
mkdir -p "$WORK"
set -a; source /c/Users/user/.boswa-migration.env; set +a
# Password kept out of the URL so special characters need no encoding.
export PGPASSWORD="$TARGET_DB_PASSWORD"

echo "== 1. target check"
existing=$("$PG/psql" "$TARGET_DB_URL" -At -c "select count(*) from pg_tables where schemaname='public'" | tr -d '\r')
users=$("$PG/psql" "$TARGET_DB_URL" -At -c "select count(*) from auth.users" | tr -d '\r')
"$PG/psql" "$TARGET_DB_URL" -At -c "select 'target server ' || version()"
if [ "$existing" != "0" ] || [ "$users" != "0" ]; then
  echo "target is not empty ($existing public tables, $users users) - stopping"; exit 1
fi

echo "== 2. build restore list"
"$PG/pg_restore" --list "$DUMP" > "$WORK/full_list.txt"
python -I "$HERE/build_restore_list.py" "$WORK/full_list.txt" "$WORK/restore_list.txt"

echo "== 3. restore (one transaction: all or nothing)"
# Lovable grants its AI sandbox roles (sandbox_exec*) access to every table.
# Those roles don't exist on the target and must not: drop just those grants.
"$PG/pg_restore" --no-owner -L "$WORK/restore_list.txt" -f "$WORK/restore_full.sql" "$DUMP"
grep -vE '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES).*sandbox_exec' "$WORK/restore_full.sql" > "$WORK/restore.sql"
if grep -q sandbox_exec "$WORK/restore.sql"; then echo "sandbox_exec still referenced - stopping"; exit 1; fi
"$PG/psql" "$TARGET_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -q -f "$WORK/restore.sql"

echo "== 4. copy stored files"
"$PG/pg_restore" --data-only --schema=storage --table=objects -f "$WORK/objects.copy" "$DUMP"
"$PG/pg_restore" --data-only --schema=storage --table=buckets -f "$WORK/buckets.copy" "$DUMP"
(cd "$WORK" && node "$HERE/copy_storage.mjs" objects.copy buckets.copy)

echo "== 5. compare row counts"
"$PG/psql" "$TARGET_DB_URL" -f "$HERE/target_counts.sql" > "$WORK/target_counts.txt"
cat "$WORK/target_counts.txt"
echo "done - compare with the export's counts"
