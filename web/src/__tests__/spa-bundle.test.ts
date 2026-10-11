import path from "node:path";
import { build, type Rollup } from "vite";
import { afterEach, expect, it, vi } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "../..");
const SERVER_ONLY_PACKAGE_PATH =
  /\/node_modules\/(pg|pg-[^/]+|drizzle-orm|@sentry\/[^/]+)\//;
const SECRET_NAMES = [
  "AUTH_SERVICE_KEY",
  "AUTH_SERVICE_URL",
  "HYPERDRIVE",
  "DATABASE_URL",
  "SENTRY_DSN",
];

afterEach(() => {
  vi.unstubAllEnvs();
});

// vite は mode でなく NODE_ENV で本番の build にする。vitest の中は NODE_ENV が test
const buildSpa = async () => {
  vi.stubEnv("NODE_ENV", "production");
  const result = (await build({
    configFile: path.join(webRoot, "vite.config.ts"),
    mode: "production",
    logLevel: "silent",
    build: { write: false },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  return [result].flat().flatMap((o) => o.output);
};

it("SPA の成果物にサーバーの module と秘密の名前が無い", async () => {
  const output = await buildSpa();
  const moduleIds = output.flatMap((o) =>
    o.type === "chunk" ? Object.keys(o.modules) : [],
  );
  const emittedTexts = output
    .map((o) => (o.type === "chunk" ? o.code : o.source))
    .filter((text) => typeof text === "string");

  expect(moduleIds.length).toBeGreaterThan(0);
  expect(
    moduleIds.filter(
      (id) =>
        !id.startsWith("\0") &&
        !id.includes("/node_modules/") &&
        !id.startsWith(`${webRoot}/`),
    ),
  ).toEqual([]);
  expect(moduleIds.filter((id) => SERVER_ONLY_PACKAGE_PATH.test(id))).toEqual(
    [],
  );
  expect(
    SECRET_NAMES.filter((name) =>
      emittedTexts.some((text) => text.includes(name)),
    ),
  ).toEqual([]);
}, 60_000);
