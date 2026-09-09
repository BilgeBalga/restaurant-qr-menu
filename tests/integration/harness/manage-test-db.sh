#!/usr/bin/env bash
# Local, ephemeral Postgres instance for Phase 2 integration tests.
#
# Fully isolated from any other Postgres on this machine: its own data
# directory, its own port, trust auth (fine — nothing sensitive, never
# reachable from outside 127.0.0.1). Not Docker, not the Supabase CLI —
# both were unavailable in this environment (Docker's daemon started but
# image pulls hung, likely a sandboxed-network restriction) — so this
# validates real Postgres/RLS/transaction behavior, not GoTrue-specific
# behavior. See local-supabase-emulation.sql and the Phase 2 report.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGDATA_DIR="$ROOT_DIR/.local/pgdata-test"
LOG_FILE="$ROOT_DIR/.local/pg-test.log"
PORT="${TABLESIDE_TEST_DB_PORT:-54329}"
DB_NAME="tableside_test"

start() {
  mkdir -p "$ROOT_DIR/.local"
  if [ ! -d "$PGDATA_DIR" ]; then
    initdb -D "$PGDATA_DIR" -U postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
  fi

  if ! pg_ctl -D "$PGDATA_DIR" status >/dev/null 2>&1; then
    pg_ctl -D "$PGDATA_DIR" -l "$LOG_FILE" -o "-p $PORT -c listen_addresses=127.0.0.1" start >/dev/null
  fi

  for _ in $(seq 1 40); do
    if pg_isready -h 127.0.0.1 -p "$PORT" -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  createdb -h 127.0.0.1 -p "$PORT" -U postgres "$DB_NAME" 2>/dev/null || true
  psql -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB_NAME" \
    -f "$ROOT_DIR/tests/integration/harness/local-supabase-emulation.sql"

  echo "Test Postgres ready: postgres://postgres@127.0.0.1:$PORT/$DB_NAME"
}

stop() {
  if [ -d "$PGDATA_DIR" ]; then
    pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null 2>&1 || true
  fi
}

reset() {
  stop
  rm -rf "$PGDATA_DIR"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  reset) reset ;;
  *)
    echo "usage: $0 {start|stop|reset}" >&2
    exit 1
    ;;
esac
