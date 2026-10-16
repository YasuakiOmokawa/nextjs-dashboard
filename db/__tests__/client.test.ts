import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { TEST_DATABASE_URL } from "@/src/services/__tests__/db/global-setup";
import { fixtureCompanyId } from "@/src/services/__tests__/db/seed";
import {
  currentCompanySetting,
  type TestDb,
} from "@/src/services/__tests__/db/test-db";
import { withCompanyScope } from "../scoped";

const urlWithApplicationName = (applicationName: string) => {
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
};

const applicationNameOf = async (db: Pick<TestDb, "execute">) =>
  (
    await db.execute<{ name: string }>(
      sql`select current_setting('application_name') as name`,
    )
  ).rows[0];

const importClientWithDatabaseUrl = async (databaseUrl: string | undefined) => {
  vi.stubEnv("DATABASE_URL", databaseUrl);
  const client = await import("../drizzle/client");
  // biome-ignore lint/style/noRestrictedImports: 要求の Pool の振る舞いを確かめる
  const pools = await import("../drizzle/pool");
  const insideRequestPool = async <T>(
    applicationName: string,
    fn: () => Promise<T>,
  ) => {
    const closing: Promise<unknown>[] = [];
    const result = await pools.runWithRequestPool(
      urlWithApplicationName(applicationName),
      (promise) => closing.push(promise),
      fn,
    );
    await Promise.all(closing);
    return result;
  };
  return { ...client, ...pools, insideRequestPool };
};

const COMPANY = fixtureCompanyId("client_test");

// transaction が接続を専有しないと、途中で外から流した文が同じ接続で実行され、事業所の設定が見える
const companyScopeSeenBy = (db: Parameters<typeof withCompanyScope>[0]) =>
  withCompanyScope(db, COMPANY, async (tx) => ({
    applicationName: (await applicationNameOf(tx))?.name,
    companySetting: await currentCompanySetting(tx),
    companySettingOutsideTransaction: await currentCompanySetting(db),
  }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("runWithRequestPool の外では DATABASE_URL の Pool に繋ぐ", async () => {
  const { db } = await importClientWithDatabaseUrl(
    urlWithApplicationName("database_url"),
  );

  expect(await applicationNameOf(db)).toEqual({ name: "database_url" });
});

it("DATABASE_URL も runWithRequestPool の Pool も無ければ、query は明示的なエラーで失敗する", async () => {
  const { db } = await importClientWithDatabaseUrl(undefined);

  await expect(applicationNameOf(db)).rejects.toHaveProperty(
    "cause.message",
    "runWithRequestPool の Pool も DATABASE_URL の Pool も無い",
  );
});

it("workerd では DATABASE_URL があっても Pool を作らず、runWithRequestPool の外の query は明示的なエラーで失敗する", async () => {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  const { db } = await importClientWithDatabaseUrl(
    urlWithApplicationName("database_url"),
  );

  await expect(applicationNameOf(db)).rejects.toHaveProperty(
    "cause.message",
    "runWithRequestPool の Pool も DATABASE_URL の Pool も無い",
  );
});

it("runWithRequestPool の中では要求の Pool に繋ぐ", async () => {
  const { db, insideRequestPool } = await importClientWithDatabaseUrl(
    urlWithApplicationName("database_url"),
  );

  expect(
    await insideRequestPool("request", () => applicationNameOf(db)),
  ).toEqual({ name: "request" });
});

it("runWithRequestPool の外では、事業所スコープの transaction を DATABASE_URL の Pool の 1 本の接続に流す", async () => {
  const { db } = await importClientWithDatabaseUrl(
    urlWithApplicationName("database_url"),
  );

  expect(await companyScopeSeenBy(db)).toEqual({
    applicationName: "database_url",
    companySetting: COMPANY,
    companySettingOutsideTransaction: expect.not.stringMatching(COMPANY),
  });
});

it("runWithRequestPool の中では、事業所スコープの transaction を要求の Pool の 1 本の接続に流す", async () => {
  const { db, insideRequestPool } = await importClientWithDatabaseUrl(
    urlWithApplicationName("database_url"),
  );

  expect(
    await insideRequestPool("request", () => companyScopeSeenBy(db)),
  ).toEqual({
    applicationName: "request",
    companySetting: COMPANY,
    companySettingOutsideTransaction: expect.not.stringMatching(COMPANY),
  });
});

it("DATABASE_URL が無くても、runWithRequestPool の中では要求の Pool に繋ぐ", async () => {
  const { db, insideRequestPool } =
    await importClientWithDatabaseUrl(undefined);

  expect(
    await insideRequestPool("request", () => applicationNameOf(db)),
  ).toEqual({ name: "request" });
});

it("要求の Pool は max 5 で作る", async () => {
  const { currentPool, insideRequestPool } =
    await importClientWithDatabaseUrl(undefined);

  expect(
    await insideRequestPool("request", async () => currentPool().options.max),
  ).toBe(5);
});

it("runWithRequestPool は fn が終わった後に要求の Pool を閉じ、閉じる処理を waitUntil に渡す", async () => {
  const { currentPool, runWithRequestPool } =
    await importClientWithDatabaseUrl(undefined);
  const closing: Promise<unknown>[] = [];

  const requestPool = await runWithRequestPool(
    urlWithApplicationName("request"),
    (promise) => closing.push(promise),
    async () => currentPool(),
  );
  await Promise.all(closing);

  expect(closing).toHaveLength(1);
  expect(requestPool.ended).toBe(true);
});

it("fn が失敗しても、runWithRequestPool は要求の Pool を閉じる", async () => {
  const { currentPool, runWithRequestPool } =
    await importClientWithDatabaseUrl(undefined);
  const closing: Promise<unknown>[] = [];
  let requestPool: ReturnType<typeof currentPool> | undefined;

  await expect(
    runWithRequestPool(
      urlWithApplicationName("request"),
      (promise) => closing.push(promise),
      async () => {
        requestPool = currentPool();
        throw new Error("handler failed");
      },
    ),
  ).rejects.toThrow("handler failed");
  await Promise.all(closing);

  expect(requestPool?.ended).toBe(true);
});

it("idle の接続が切れて Pool が 'error' を出しても投げず、console.error に出す", async () => {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const { currentPool, insideRequestPool } = await importClientWithDatabaseUrl(
    urlWithApplicationName("database_url"),
  );
  const idleClientError = new Error("idle client error");

  currentPool().emit("error", idleClientError);
  await insideRequestPool("request", async () =>
    currentPool().emit("error", idleClientError),
  );

  expect(consoleError).toHaveBeenCalledTimes(2);
});

it("並行に走る runWithRequestPool は、それぞれ自分の Pool に繋ぐ", async () => {
  const { db, insideRequestPool } =
    await importClientWithDatabaseUrl(undefined);
  const bothEntered = Promise.withResolvers<void>();
  let entered = 0;
  const queryAfterBothEntered = (applicationName: string) =>
    insideRequestPool(applicationName, async () => {
      if (++entered === 2) bothEntered.resolve();
      await bothEntered.promise;
      return applicationNameOf(db);
    });

  expect(
    await Promise.all([queryAfterBothEntered("a"), queryAfterBothEntered("b")]),
  ).toEqual([{ name: "a" }, { name: "b" }]);
});
