// usage: node scripts/neon-setup.mjs <owner.url> <app.url>
// 手元の社内ネットワークから Neon の 5432 に届かないので、443 の WebSocket (neon-serverless) で
// 既存の migration を流し、ADR-0005 と同じ権限の RLS を bypass しない role taimei_app を作る
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const [ownerPath, appPath] = process.argv.slice(2);
const owner = new URL(readFileSync(ownerPath, "utf8").trim());
const pool = new Pool({ connectionString: owner.toString() });
const sql = { query: async (q) => (await pool.query(q)).rows };
await migrate(drizzle(pool), { migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname });
console.log("migrations", await sql.query("select count(*)::int as n from drizzle.__drizzle_migrations"));

const password = randomBytes(18).toString("hex");
await sql.query(
  "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taimei_app') THEN CREATE ROLE taimei_app LOGIN; END IF; END $$",
);
await sql.query(`ALTER ROLE taimei_app PASSWORD '${password}'`);
await sql.query("GRANT USAGE ON SCHEMA public TO taimei_app");
await sql.query(
  "GRANT SELECT, INSERT, UPDATE, DELETE ON teams, skills, team_assignments, member_skills TO taimei_app",
);
console.log("taimei_app", await sql.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'taimei_app'"));
console.log("rls", await sql.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('teams','skills','team_assignments','member_skills') ORDER BY relname"));
await pool.end();

// Hyperdrive は自前で pool するので Neon の pooler ではなく直接の host を使う
const app = new URL(owner.toString());
app.hostname = app.hostname.replace("-pooler", "");
app.username = "taimei_app";
app.password = password;
app.search = "?sslmode=require";
writeFileSync(appPath, app.toString(), { mode: 0o600 });
