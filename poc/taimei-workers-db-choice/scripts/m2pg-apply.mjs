// usage: node scripts/m2pg-apply.mjs <owner.url>
// M2 の Postgres 側: (1) 既存の行に違反する CHECK を足して失敗させ、全体が元に戻るか (2) drizzle-kit が生成した
// 0012 (teams に CHECK) を drizzle の migrator で流し、子の行が残るかを見る。手元から 5432 に届かないので 443 の WebSocket で流す
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const pool = new Pool({ connectionString: readFileSync(process.argv[2], "utf8").trim() });
const counts = async () =>
  (
    await pool.query(
      "SELECT (SELECT count(*) FROM teams)::int AS teams, (SELECT count(*) FROM skills)::int AS skills, (SELECT count(*) FROM team_assignments)::int AS team_assignments, (SELECT count(*) FROM member_skills)::int AS member_skills",
    )
  ).rows[0];
const constraints = async () =>
  (await pool.query("SELECT conname FROM pg_constraint WHERE conrelid = 'teams'::regclass AND contype = 'c' ORDER BY conname")).rows.map((r) => r.conname);

console.log("before", await counts(), await constraints());
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("ALTER TABLE teams ADD CONSTRAINT teams_name_short CHECK (length(name) <= 3)");
  await client.query("COMMIT");
  console.log("violating check: committed (unexpected)");
} catch (e) {
  await client.query("ROLLBACK");
  console.log("violating check: failed and rolled back:", e.code, e.message);
} finally {
  client.release();
}
console.log("after failed", await counts(), await constraints());
await migrate(drizzle(pool), { migrationsFolder: new URL("../m2pg/drizzle", import.meta.url).pathname });
console.log("after 0012", await counts(), await constraints());
console.log("migrations", (await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0]);
await pool.end();
