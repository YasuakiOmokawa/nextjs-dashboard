#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
AUTH_DIR=${TAIMEI_AUTH_DIR:-$ROOT/../taimei-auth}
TMP=${TMPDIR:-/tmp}
STATE=${TMP%/}/taimei-qa
PG=taimei-qa-pg
PG_URL=postgres://postgres:password@localhost:5446
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
  until docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  docker exec "$PG" psql -qU postgres -c 'CREATE DATABASE auth' -c 'CREATE DATABASE taimei'
  (
    cd "$AUTH_DIR"
    export DATABASE_URL=$PG_URL/auth APP_ENV=development
    bun run db:migrate && bun run db:migrate-manual
  ) >"$STATE/migrate.log" 2>&1
  DATABASE_URL=$PG_URL/taimei bunx drizzle-kit migrate >>"$STATE/migrate.log" 2>&1
  # 本番の taimei_app と同じ GRANT の、RLS を bypass しない role (docs/adr/0005)
  docker exec "$PG" psql -qU postgres -d taimei \
    -c "CREATE ROLE qa_app LOGIN PASSWORD 'qa'" \
    -c "GRANT USAGE ON SCHEMA public TO qa_app" \
    -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qa_app"

  local id email company
  id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  email="qa-${id:0:8}@example.com"
  company="cmp_qa${id:0:8}"
  docker exec "$PG" psql -qU postgres -d auth \
    -c "INSERT INTO \"user\" (id, name, email, email_verified) VALUES ('$id', 'QA 管理者', '$email', false)" \
    -c "INSERT INTO company (id, name, org_code) VALUES ('$company', 'QA 事業所', 'CORPORATE')" \
    -c "INSERT INTO membership (id, user_id, company_id, role) VALUES (gen_random_uuid()::text, '$id', '$company', 'OWNER')" \
    -c "UPDATE \"user\" SET last_used_company_id = '$company' WHERE id = '$id'"

  # 2 つのリポジトリの .env の AUTH_SERVICE_KEY が違い、そのままだと VerifySession が 401 になる
  (
    cd "$AUTH_DIR"
    PORT=3110 DATABASE_URL=$PG_URL/auth AUTH_SERVICE_URL=http://localhost:3110 \
      AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://localhost:3110 \
      APP_ENV=development APP_NAME=taimei AUTH_SECRET=test-secret-for-e2e-testing-32chars \
      AUTH_SERVICE_KEY= AUTH_SERVICE_KEY_PREVIOUS= \
      nohup bun run src/index.ts >"$STATE/auth.log" 2>&1 &
  )
  bun run build >"$STATE/app.log" 2>&1
  PORT=3000 AUTH_URL=http://localhost:3110 AUTH_SERVICE_URL=http://localhost:3110 DATABASE_URL=postgres://$app_db_user@localhost:5446/taimei \
    nohup bun run start >>"$STATE/app.log" 2>&1 &
  wait_for http://localhost:3110/
  wait_for http://localhost:3000/

  echo "http://localhost:3000/ を開き、$email に Magic Link を送ってから bun run qa:login"
}

login() {
  local link
  link=$(grep -oE 'http://localhost:3110[^ "]*token=[^ "]*' "$STATE/auth.log" | tail -1 || true)
  if [[ -z $link ]]; then
    echo "auth のログに Magic Link がまだ無い" >&2
    exit 1
  fi
  (
    umask 077
    printf '<meta http-equiv="refresh" content="0;url=%s">' "$link" >"$STATE/login.html"
  )
  nohup sh -c "sleep 30; rm -f '$STATE/login.html'" >/dev/null 2>&1 &
  echo "file://$STATE/login.html を 30 秒以内に開く"
}

down() {
  for port in 3000 3110; do
    lsof -tiTCP:"$port" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  done
  # port 3000 を持つのは workerd だけで、親の wrangler (node) は残る
  pkill -f "wrangler.js dev --ip 0.0.0.0 --port 3000" || true
  docker rm -f "$PG" >/dev/null 2>&1 || true
  rm -rf "$STATE"
}

case ${1:-} in
serve) shift && serve "$@" ;;
login) login ;;
down) down ;;
*)
  echo "usage: $0 serve [--app-role] | login | down" >&2
  exit 1
  ;;
esac
