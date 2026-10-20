import { defineConfig } from "drizzle-kit";

// 既存の migration (リポジトリの drizzle/) をそのまま PoC の Neon に流す
export default defineConfig({
  dialect: "postgresql",
  out: "../../../drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
