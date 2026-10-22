#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
TMP=${TMPDIR:-/tmp}
STATE=${TMP%/}/taimei-qa
PG=taimei-qa-pg
PG_URL=postgres://postgres:password@localhost:5446
APP_URL=http://localhost:3000
AUTH_URL=http://localhost:3110
# 3100・5435 は手元の ssh のトンネルが使う
PORTS=(3000 3110 5446)

wait_for() {
  for _ in $(seq 1 120); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "$1 に届かない ($STATE の log を見る)" >&2
  exit 1
}

auth_compose() {
  TAIMEI_AUTH_URL=$AUTH_URL TAIMEI_AUTH_HOSTNAME=taimei-auth-qa TAIMEI_AUTH_COOKIE_DOMAIN= \
    TAIMEI_AUTH_CONSUMER_ORIGINS=$APP_URL TAIMEI_AUTH_SECRET=qa-secret-for-testing-harness-32chars \
    TAIMEI_AUTH_APP_NAME=taimei \
    docker compose -p taimei-qa -f "$ROOT/node_modules/@taimei-code/auth-client/testing/compose.yml" -f - "$@" <<'YAML'
services:
  taimei-auth:
    ports:
      - "127.0.0.1:3110:3100"
YAML
}

serve() {
  local app_db_user=postgres:password
  if [[ ${1:-} == --app-role ]]; then app_db_user=qa_app:qa; fi
  for port in "${PORTS[@]}"; do
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port $port は使用中" >&2
      exit 1
    fi
  done
  mkdir -p "$STATE"

  docker run -d --name "$PG" -e POSTGRES_PASSWORD=password -p 5446:5432 postgres:16.8-alpine3.21 >/dev/null
  auth_compose up -d --wait >"$STATE/auth-compose.log" 2>&1 &
  local auth_pid=$!
  until docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  docker exec "$PG" psql -qU postgres -c 'CREATE DATABASE taimei'
  DATABASE_URL=$PG_URL/taimei bunx drizzle-kit migrate >"$STATE/migrate.log" 2>&1
  # 本番の taimei_app と同じ GRANT の、RLS を bypass しない role (docs/adr/0005)
  docker exec "$PG" psql -qU postgres -d taimei \
    -c "CREATE ROLE qa_app LOGIN PASSWORD 'qa'" \
    -c "GRANT USAGE ON SCHEMA public TO qa_app" \
    -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qa_app"

  bun run build >"$STATE/app.log" 2>&1
  wait "$auth_pid" || { echo "auth が起動しない ($STATE/auth-compose.log を見る)" >&2; exit 1; }
  PORT=3000 AUTH_URL=$AUTH_URL AUTH_SERVICE_URL=$AUTH_URL DATABASE_URL=postgres://$app_db_user@localhost:5446/taimei \
    nohup bun run start >>"$STATE/app.log" 2>&1 &
  wait_for "$APP_URL/"

  echo "bun run qa:login でログインする"
}

login() {
  mkdir -p "$STATE"
  local link file=$STATE/login-$$.html
  link=$(cd "$ROOT" && bun -e '
    import { createUser } from "./e2e/tests/utils/testing-auth";
    const user = await createUser({ name: "QA 管理者", companies: [{ name: "QA 事業所", role: "OWNER" }] });
    console.log(user.loginUrl);
  ')
  (
    umask 077
    printf '<meta http-equiv="refresh" content="0;url=%s">' "$link" >"$file"
  )
  nohup sh -c "sleep 30; rm -f '$file'" >/dev/null 2>&1 &
  echo "file://$file を 30 秒以内に開く"
}

down() {
  lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill 2>/dev/null || true
  # port 3000 を持つのは workerd だけで、親の wrangler (node) は残る
  pkill -f "wrangler.js dev --ip 0.0.0.0 --port 3000" || true
  local out
  out=$(auth_compose down 2>&1) || { printf '%s\n' "$out" >&2; exit 1; }
  docker rm -f "$PG" >/dev/null 2>&1 || true
  rm -rf "$STATE"
}

case ${1:-} in
serve) shift && serve "$@" ;;
login) AUTH_BASE_URL=$AUTH_URL APP_BASE_URL=$APP_URL login ;;
dev-login) login ;;
down) down ;;
*)
  echo "usage: $0 serve [--app-role] | login | dev-login | down" >&2
  exit 1
  ;;
esac
