import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./schema.ts",
  out: `./drizzle-${process.env.M2_ON_DELETE}`,
});
