#!/usr/bin/env bash
# Local development PostgreSQL bootstrap (sandbox / VPS developer machines).
#
# Production uses a normally installed PostgreSQL server (see docs/DEPLOYMENT.md).
# This script only exists so developers (and automated agents) can run the real
# PostgreSQL engine locally without root access: it fetches the official
# PostgreSQL binaries published on npm and manages a local cluster.
#
# Usage:
#   scripts/dev-db.sh start     # install (if needed), initdb (if needed), start, ensure DBs
#   scripts/dev-db.sh stop
#   scripts/dev-db.sh status
#   scripts/dev-db.sh psql
set -euo pipefail

PG_VERSION="${PG_VERSION:-17.10.0-beta.17}"
PG_HOME="${PG_HOME:-$HOME/.cache/pg-dev}"
PGDATA="${PGDATA:-$PG_HOME/data}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_DATABASE="${PG_DATABASE:-estore}"
PG_SHADOW_DATABASE="${PG_SHADOW_DATABASE:-estore_shadow}"
NATIVE="$PG_HOME/node_modules/@embedded-postgres/linux-x64/native"
export PATH="$NATIVE/bin:$PATH"
export LD_LIBRARY_PATH="$NATIVE/lib:${LD_LIBRARY_PATH:-}"

ensure_binaries() {
  if [ -x "$NATIVE/bin/postgres" ]; then return 0; fi
  echo "Installing PostgreSQL $PG_VERSION binaries into $PG_HOME ..."
  mkdir -p "$PG_HOME"
  [ -f "$PG_HOME/package.json" ] || echo '{"name":"pg-dev","private":true}' > "$PG_HOME/package.json"
  (cd "$PG_HOME" && npm install --no-audit --no-fund "@embedded-postgres/linux-x64@$PG_VERSION" >/dev/null)
}

ensure_cluster() {
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing cluster at $PGDATA ..."
    mkdir -p "$PGDATA"
    initdb -D "$PGDATA" -U "$PG_USER" --auth=trust --encoding=UTF8 --locale=C >/dev/null
  fi
}

start() {
  ensure_binaries
  ensure_cluster
  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo "PostgreSQL already running on port $PG_PORT"
  else
    # unix_socket_directories is kept inside PGDATA so nothing is written system-wide
    pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGDATA" start >/dev/null
    echo "PostgreSQL started on 127.0.0.1:$PG_PORT"
  fi
  # The npm build of PostgreSQL ships only the server binaries, so databases are
  # created through the pg client library instead of the psql/createdb tools.
  node "$(dirname "$0")/pg-admin.mjs" ensure-databases \
    --host 127.0.0.1 --port "$PG_PORT" --user "$PG_USER" \
    --databases "$PG_DATABASE,$PG_SHADOW_DATABASE"
  echo "DATABASE_URL=postgresql://$PG_USER@127.0.0.1:$PG_PORT/$PG_DATABASE?schema=public"
}

stop() {
  ensure_binaries
  pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  echo "PostgreSQL stopped"
}

status() {
  ensure_binaries
  pg_ctl -D "$PGDATA" status || true
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  psql) shift || true; node "$(dirname "$0")/pg-admin.mjs" sql --host 127.0.0.1 --port "$PG_PORT" --user "$PG_USER" --database "$PG_DATABASE" "$@" ;;
  *) echo "Unknown command: $1" >&2; exit 1 ;;
esac
