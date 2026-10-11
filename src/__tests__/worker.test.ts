import type { ExecutionContext } from "hono";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/db/drizzle/client";
// biome-ignore lint/style/noRestrictedImports: 定期処理が要求ごとの Pool の中で動くことを確かめる
import { currentPool } from "@/db/drizzle/pool";
import { purgeDeparted } from "@/src/lib/purge-departed";
import type { Env } from "../app";
import { handler } from "../worker";

vi.mock("@/src/lib/purge-departed", () => ({ purgeDeparted: vi.fn() }));

const CONNECTION_STRING = "postgres://scheduled@127.0.0.1:1/taimei";
const PURGE_REPORT = {
  deletedCompanyIds: [],
  removedAssignments: 0,
  skippedCompanyIds: [],
};

const envWithBinding = (fetch: typeof globalThis.fetch = vi.fn()): Env => ({
  HYPERDRIVE: { connectionString: CONNECTION_STRING },
  AUTH: { fetch },
  AUTH_URL: "https://auth.example",
  AUTH_SERVICE_KEY: "service-key",
});

const collectingContext = () => {
  const waited: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => waited.push(promise),
    passThroughOnException: () => {},
    props: {},
  } as ExecutionContext;
  return { ctx, waited };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(purgeDeparted).mockReset();
});

const poolOfScheduledRun = (purge: () => Promise<typeof PURGE_REPORT>) => {
  const used: { pool?: Pool } = {};
  vi.mocked(purgeDeparted).mockImplementation(async () => {
    used.pool = currentPool();
    return purge();
  });
  return used;
};

it("定期処理は env の接続文字列で開いた要求ごとの Pool の中で、purgeDeparted に db と始めた時刻を渡す", async () => {
  const used = poolOfScheduledRun(async () => PURGE_REPORT);
  const { ctx } = collectingContext();
  const before = Date.now();

  await handler.scheduled({}, envWithBinding(), ctx);

  expect(purgeDeparted).toHaveBeenCalledOnce();
  const [{ db: passedDb, startedAt }] = vi.mocked(purgeDeparted).mock.calls[0];
  expect(passedDb).toBe(db);
  expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(startedAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(used.pool?.options.connectionString).toBe(CONNECTION_STRING);
});

it("定期処理の要求ごとの Pool は、waitUntil に渡した Promise の解決で閉じている", async () => {
  const used = poolOfScheduledRun(async () => PURGE_REPORT);
  const { ctx, waited } = collectingContext();

  await handler.scheduled({}, envWithBinding(), ctx);
  await Promise.all(waited);

  expect(waited).toHaveLength(1);
  expect(used.pool?.ended).toBe(true);
});

it("purgeDeparted が失敗すると定期処理も同じ error で失敗し、Pool は閉じている", async () => {
  const failure = new Error("db down");
  const used = poolOfScheduledRun(async () => {
    throw failure;
  });
  const { ctx, waited } = collectingContext();

  await expect(handler.scheduled({}, envWithBinding(), ctx)).rejects.toBe(
    failure,
  );
  await Promise.all(waited);

  expect(waited).toHaveLength(1);
  expect(used.pool?.ended).toBe(true);
});

it("定期処理の照合は taimei-auth の CheckMemberships を Service Binding へ Service Key 付きで送る", async () => {
  vi.mocked(purgeDeparted).mockResolvedValue(PURGE_REPORT);
  const binding = vi.fn<typeof fetch>(async () =>
    Response.json({ companyActive: true, memberUserIds: ["u_1"] }),
  );
  await handler.scheduled({}, envWithBinding(binding), collectingContext().ctx);
  const [{ checkMemberships }] = vi.mocked(purgeDeparted).mock.calls[0];

  const answer = await checkMemberships({
    companyId: "cmp_a",
    userIds: ["u_1"],
  });

  expect(answer).toMatchObject({ companyActive: true, memberUserIds: ["u_1"] });
  expect(binding).toHaveBeenCalledOnce();
  const [input, init] = binding.mock.calls[0];
  expect(String(input)).toMatch(/\/CheckMemberships$/);
  expect(new Headers(init?.headers).get("X-Service-Key")).toBe("service-key");
  expect(
    JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)),
  ).toEqual({ companyId: "cmp_a", userIds: ["u_1"] });
});

it("定期処理は purgeDeparted の結果を 1 回 console.info に出す", async () => {
  vi.mocked(purgeDeparted).mockResolvedValue(PURGE_REPORT);
  const info = vi.spyOn(console, "info").mockImplementation(() => {});

  await handler.scheduled({}, envWithBinding(), collectingContext().ctx);

  expect(info).toHaveBeenCalledExactlyOnceWith("purge-departed", PURGE_REPORT);
});
