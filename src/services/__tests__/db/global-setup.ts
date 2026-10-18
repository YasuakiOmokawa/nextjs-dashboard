import { execSync } from "child_process";
import { resolve } from "path";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:password@localhost:5434/taimei_test";

const projectRoot = resolve(__dirname, "../../../../");

export async function setup() {
  console.log("🔧 Setting up test database...");
  await waitForDb();
  execSync("bunx drizzle-kit migrate", {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  console.log("✅ Test database ready");
}

export async function teardown() {
  console.log("🧹 Test database teardown complete");
}

async function waitForDb(maxRetries = 10, delayMs = 1000) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      console.log(`Waiting for test_db... (${i + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(
    "Test database not available: docker compose up -d test_db --wait で起こす",
  );
}
