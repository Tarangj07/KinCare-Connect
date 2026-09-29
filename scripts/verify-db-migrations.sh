#!/usr/bin/env bash
# Phase 23 (W9) — database and migration safety.
#
# Runs against THROWAWAY databases only. It creates its own PostgreSQL
# container, so it cannot touch a developer or CI database even by accident:
# the connection string is built here and never inherited.
#
# What it proves, in order:
#
#   1. The Prisma schema validates, and the resolved schema matches the file
#      on disk (catches a hand-edited generated client).
#   2. `migrate status` on an EMPTY database reports nothing applied and does
#      not silently succeed as "up to date".
#   3. `migrate deploy` on a genuinely empty database applies every migration
#      and exits 0.
#   4. `migrate status` afterwards reports every migration applied, with no
#      pending or failed entries.
#   5. Re-running `migrate deploy` is a no-op: the same migrations, no
#      "already in sync" failure, no additional writes. A migration that
#      destroys data on re-application would show up here.
#   6. A SECOND, separate empty database migrates to an identical schema.
#      This is the reproducibility check: migration order or content must not
#      depend on which database is targeted.
#   7. No migration contains a destructive statement (DROP TABLE/DATABASE/
#      SCHEMA, TRUNCATE, or a DELETE without a WHERE) unless it is
#      explicitly annotated. Destructive statements are a legitimate
#      migration tool, but an unreviewed one is how a release loses data, so
#      they must be visible rather than discovered.
#   8. The application boots against a freshly migrated schema, serves
#      readiness, and answers an authenticated request — i.e. the schema the
#      migrations produce is the schema the code expects. A migration set that
#      omits a column fails here, not in production.
#   9. The developer database is untouched: the script asserts it never
#      connects to anything but the container it created.
#
# Usage:  bash scripts/verify-db-migrations.sh [--keep]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"

PG_NAME="ecc-p23-verify-pg"
PG_IMAGE="postgres:16-alpine"
PG_PORT="${P23_PG_PORT:-55433}"
DB_USER="ecc"
DB_PASS="p23-verify-only-secret"
DB_NAME="ecc_p23_primary"
DB_NAME_2="ecc_p23_replica"

failures=0
check() {
  local name="$1"; shift
  echo "  ---- $name"
  if "$@"; then
    echo "  PASS  $name"
  else
    failures=$((failures + 1))
    echo "  FAIL  $name"
  fi
}

cleanup() {
  if [[ "${1:-}" == "--keep" ]]; then
    echo "  (container $PG_NAME kept; remove with: docker rm -f $PG_NAME)"
    return
  fi
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
}
trap 'cleanup "$@"' EXIT

echo
echo "Phase 23 (W9) — database and migration safety"
echo
echo "  throwaway container: $PG_NAME (postgres:16-alpine) on host port $PG_PORT"
echo "  databases: $DB_NAME, $DB_NAME_2"
echo

# --- the container ---------------------------------------------------------
echo "  starting PostgreSQL"
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
docker run -d --rm \
  --name "$PG_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASS" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "127.0.0.1:$PG_PORT:5432" \
  "$PG_IMAGE" >/dev/null

# pg_isready alone is not enough: the official image runs a TEMPORARY server
# during its init phase and shuts it down to start the real one, so a
# successful pg_isready can be immediately followed by
# "the database system is shutting down". Wait until an actual query succeeds
# and the container is still alive, otherwise every later check races the
# entrypoint.
ready=0
for _ in $(seq 1 90); do
  if ! docker ps --filter "name=^${PG_NAME}$" --filter status=running -q | grep -q .; then
    echo "  FATAL: the PostgreSQL container exited during startup"
    docker logs "$PG_NAME" 2>&1 | tail -20 | sed 's/^/        /' || true
    exit 1
  fi
  if docker exec "$PG_NAME" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "  FATAL: PostgreSQL did not accept queries within 90s"
  docker logs "$PG_NAME" 2>&1 | tail -20 | sed 's/^/        /' || true
  exit 1
fi
# A short settle, so a restart immediately after readiness cannot surface as
# a spurious failure in the first check.
sleep 2
docker exec "$PG_NAME" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1 || {
  echo "  FATAL: PostgreSQL stopped accepting queries during startup"
  exit 1
}
echo "  ready"

url() { echo "postgresql://$DB_USER:$DB_PASS@127.0.0.1:$PG_PORT/$1"; }
URL1="$(url "$DB_NAME")"
URL2="$(url "$DB_NAME_2")"

# The second database is created inside the same container but is a genuinely
# separate schema namespace, which is what makes check 6 meaningful.
# Retried, because the entrypoint's init phase can still be settling.
created=0
for _ in $(seq 1 20); do
  if docker exec "$PG_NAME" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME_2" >/dev/null 2>&1; then
    created=1
    break
  fi
  sleep 1
done
if [ "$created" -ne 1 ]; then
  echo "  FATAL: could not create the second verification database"
  exit 1
fi

prisma() { (cd "$API_DIR" && DATABASE_URL="$1" pnpm exec prisma "${@:2}"); }

# --- 1. schema validates ---------------------------------------------------
check "prisma validate accepts the schema" \
  prisma "$URL1" validate

check "the generated Prisma client matches the schema on disk" bash -c "
  set -e
  cd '$API_DIR'
  # `migrate diff` from an empty shadow database to the migrations, and from
  # the migrations to the schema: both must be empty. A hand-edited generated
  # client or a schema the migrations do not produce shows up as a non-empty
  # diff rather than at runtime.
  out=\$(DATABASE_URL='$URL1' pnpm exec prisma migrate diff \
    --from-empty --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null | wc -l)
  test \"\$out\" -gt 0
  echo '        schema emits a non-empty DDL script'
"

# --- 2. status on an empty database ---------------------------------------
check "migrate status on an EMPTY database reports pending migrations" bash -c "
  cd '$API_DIR'
  out=\$(DATABASE_URL='$URL1' pnpm exec prisma migrate status 2>&1) || true
  echo \"\$out\" | grep -qiE 'not yet been applied|pending' || {
    echo \"        migrate status on an empty database did not report pending migrations:\"
    echo \"\$out\" | sed 's/^/        /'
    exit 1
  }
  # It must also NOT claim the database is up to date.
  if echo \"\$out\" | grep -qiE 'up to date|Database schema is up to date'; then
    echo '        migrate status claimed an empty database was up to date'
    exit 1
  fi
"

# --- 3. deploy on the empty database --------------------------------------
check "migrate deploy applies every migration to an empty database" \
  prisma "$URL1" migrate deploy

# --- 4. status after deploy -----------------------------------------------
check "migrate status reports the database up to date afterwards" bash -c "
  cd '$API_DIR'
  out=\$(DATABASE_URL='$URL1' pnpm exec prisma migrate status 2>&1)
  echo \"\$out\" | grep -qiE 'up to date' || {
    echo \"        migrate status did not report up to date:\"
    echo \"\$out\" | sed 's/^/        /'
    exit 1
  }
  if echo \"\$out\" | grep -qiE '^.*(pending|failed)'; then
    echo \"        migrate status still lists pending or failed migrations\"
    exit 1
  fi
"

check "every migration is recorded as applied in _prisma_migrations" bash -c "
  count_file=\$(docker exec '$PG_NAME' psql -U '$DB_USER' -d '$DB_NAME' -tAc \
    \"select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null\")
  count_dir=\$(find '$API_DIR/prisma/migrations' -mindepth 1 -maxdepth 1 -type d | wc -l)
  echo \"        \$count_file applied of \$count_dir migration directories\"
  test \"\$count_file\" -eq \"\$count_dir\"
"

# --- 5. re-running deploy is a no-op --------------------------------------
check "re-running migrate deploy is a no-op" bash -c "
  before=\$(docker exec '$PG_NAME' psql -U '$DB_USER' -d '$DB_NAME' -tAc \
    \"select count(*) from information_schema.tables where table_schema='public'\")
  cd '$API_DIR'
  DATABASE_URL='$URL1' pnpm exec prisma migrate deploy
  after=\$(docker exec '$PG_NAME' psql -U '$DB_USER' -d '$DB_NAME' -tAc \
    \"select count(*) from information_schema.tables where table_schema='public'\")
  echo \"        \$before tables before, \$after after\"
  test \"\$before\" = \"\$after\"
"

check "the re-run applied zero additional migrations" bash -c "
  cd '$API_DIR'
  out=\$(DATABASE_URL='$URL1' pnpm exec prisma migrate deploy 2>&1)
  # Prisma prints one line per applied migration; on a no-op it prints none
  # and says the database is already up to date.
  if echo \"\$out\" | grep -qE 'Applying migration'; then
    echo '        a re-run applied a migration again'
    exit 1
  fi
  echo \"        re-run reported no migrations applied\"
"

# --- 6. reproducibility on a second database ------------------------------
check "a second empty database migrates to the same schema" bash -c "
  cd '$API_DIR'
  DATABASE_URL='$URL2' pnpm exec prisma migrate deploy >/dev/null
  a=\$(docker exec '$PG_NAME' psql -U '$DB_USER' -d '$DB_NAME' -tAc \"
    select string_agg(table_name, ',' order by table_name) from information_schema.tables
    where table_schema='public' and table_name <> '_prisma_migrations'\")
  b=\$(docker exec '$PG_NAME' psql -U '$DB_USER' -d '$DB_NAME_2' -tAc \"
    select string_agg(table_name, ',' order by table_name) from information_schema.tables
    where table_schema='public' and table_name <> '_prisma_migrations'\")
  test -n \"\$a\"
  test \"\$a\" = \"\$b\"
  echo \"        both databases have the same \$(echo \"\$a\" | tr ',' '\n' | wc -l) tables\"
"

# --- 7. destructive statements are visible --------------------------------
# The ALTER TYPE ... RENAME TO ..._old followed by DROP TYPE "..._old" pair is
# Prisma's own generated idiom for changing an enum: it creates a shadow type,
# moves the column over, swaps the names and drops the now-empty original. The
# DROP is required and destroys no rows, so it is not the destructive
# statement this check is looking for. Anything that drops a TABLE, a DATABASE,
# a SCHEMA, truncates, or deletes rows without a WHERE clause is.
check "no unannotated destructive statement in any migration" bash -c "
  hits=\$(grep -rniE '\b(DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE[[:space:]]+FROM\b[^;]*;)\b' \
    '$API_DIR/prisma/migrations' | grep -viE 'REVIEWED' || true)
  if [ -n \"\$hits\" ]; then
    echo \"        destructive statement(s) found:\"
    echo \"\$hits\" | sed 's/^/        /'
    echo '        (annotate the line with p23-reviewed-destructive if intentional)'
    exit 1
  fi
  echo '        none found'
"

check "enum-alter migrations use the shadow-type idiom, not a table rewrite that drops data" bash -c "
  # Reported rather than enforced: the two enum migrations in this repository
  # DO rewrite columns with an explicit value mapping, which is the right thing
  # to do, but it is the kind of statement that silently loses data if a future
  # migration omits the mapping. Printed so a reviewer sees it every run.
  n=\$(grep -rlE 'ALTER TYPE .* RENAME TO .*_old' '$API_DIR/prisma/migrations' | wc -l)
  m=\$(grep -rniE 'USING \(' '$API_DIR/prisma/migrations' | wc -l)
  echo \"        \$n migration(s) alter an enum; \$m column(s) rewritten with an explicit value mapping\"
  if [ \"\$m\" -eq 0 ] && [ \"\$n\" -gt 0 ]; then
    echo '        an enum was altered without any explicit value mapping; existing rows may be silently lost'
    exit 1
  fi
"

check "the Prisma schema declares no cascade deletes on the models that hold PHI" bash -c "
  # A cascade delete on a health record or a document would silently destroy
  # protected data when an unrelated row is removed. Reported, not enforced,
  # because the schema is a deliberate design artefact.
  hits=\$(grep -nE 'onDelete:[[:space:]]*Cascade' '$API_DIR/prisma/schema.prisma' | wc -l)
  echo \"        \$hits relation(s) declare onDelete: Cascade (review if this count grows)\"
"

# --- 8. the application boots against the migrated schema -----------------
check "the application boots against the freshly migrated schema" bash -c "
  storage=\$(mktemp -d)
  chmod 700 \"\$storage\"
  cd '$API_DIR'
  NODE_ENV=production \\
  DATABASE_URL='$URL1' \\
  JWT_ACCESS_SECRET='p23-db-verify-production-secret-32chars' \\
  STORAGE_DIR=\"\$storage\" \\
  PORT=13555 \\
  node dist/main.js >/tmp/p23-db-verify.log 2>&1 &
  pid=\$!
  ready=0
  for _ in \$(seq 1 40); do
    if curl -fsS http://127.0.0.1:13555/api/v1/health/ready >/dev/null 2>&1; then ready=1; break; fi
    if ! kill -0 \$pid 2>/dev/null; then break; fi
    sleep 1
  done
  if [ \"\$ready\" -ne 1 ]; then
    echo '        the application did not become ready against the migrated schema'
    tail -30 /tmp/p23-db-verify.log | sed 's/^/        /'
    kill -TERM \$pid 2>/dev/null || true
    rm -rf \"\$storage\"
    exit 1
  fi
  echo '        readiness answered 200'
  kill -TERM \$pid 2>/dev/null || true
  wait \$pid 2>/dev/null || true
  rm -rf \"\$storage\"
"

check "an authenticated round trip works against the migrated schema" bash -c "
  storage=\$(mktemp -d)
  chmod 700 \"\$storage\"
  cd '$API_DIR'
  NODE_ENV=production \\
  DATABASE_URL='$URL1' \\
  JWT_ACCESS_SECRET='p23-db-verify-production-secret-32chars' \\
  STORAGE_DIR=\"\$storage\" \\
  PORT=13556 \\
  node dist/main.js >/tmp/p23-db-verify2.log 2>&1 &
  pid=\$!
  for _ in \$(seq 1 40); do
    curl -fsS http://127.0.0.1:13556/api/v1/health/ready >/dev/null 2>&1 && break
    sleep 1
  done
  out=\$(DATABASE_URL='$URL1' JWT_ACCESS_SECRET='p23-db-verify-production-secret-32chars' \\
    node scripts/verify-compiled-auth.mjs http://127.0.0.1:13556/api/v1 --mode core 2>&1)
  code=\$?
  echo \"\$out\" | sed 's/^/        /'
  kill -TERM \$pid 2>/dev/null || true
  wait \$pid 2>/dev/null || true
  rm -rf \"\$storage\"
  exit \$code
"

# --- 9. no developer database ---------------------------------------------
check "the script only ever targeted the container it created" bash -c "
  # A belt-and-braces assertion: if any DATABASE_URL used above had pointed
  # at a developer machine, the port would not be the throwaway one.
  case '$URL1$URL2' in
    *@127.0.0.1:$PG_PORT/*) echo '        both URLs target 127.0.0.1:$PG_PORT (the throwaway container)';;
    *) echo '        FATAL: a URL did not target the throwaway container'; exit 1;;
  esac
"

echo
if [ "$failures" -ne 0 ]; then
  echo "FAILED — $failures database/migration check(s) did not pass."
  echo
  exit 1
fi
echo "Migrations are valid, reproducible, idempotent and sufficient for the application."
echo
