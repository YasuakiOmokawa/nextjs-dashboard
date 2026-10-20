#!/usr/bin/env bash
# M2 の Postgres 側: 既存の schema と migration を m2pg/ に写し、teams に CHECK を足した差分を drizzle-kit で生成する
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/../.." && pwd)
rm -rf "$here/m2pg" && mkdir -p "$here/m2pg"
cp -R "$root/drizzle" "$here/m2pg/drizzle"
sed -e 's#from "../ids"#from "../../../db/ids"#' \
  -e 's#    unique().on(table.companyId, table.name),#    unique().on(table.companyId, table.name),\n    check("teams_name_length", sql`length(${table.name}) <= 50`),#' \
  "$root/db/drizzle/schema.ts" >"$here/m2pg/schema.ts"
cat >"$here/m2pg/drizzle.config.ts" <<'EOF'
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
EOF
cd "$here/m2pg" && NODE_PATH="$here/node_modules" "$here/node_modules/.bin/drizzle-kit" generate --name add_teams_check
