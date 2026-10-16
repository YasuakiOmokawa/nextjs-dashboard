import { buildSessionCookieHeader } from "@taimei-code/auth-client";
import { DrizzleQueryError } from "drizzle-orm";
import { Effect } from "effect";
import type { ExecutionContext } from "hono";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/db/drizzle/client";
// biome-ignore lint/style/noRestrictedImports: 定期処理が要求ごとの Pool の中で動くことを確かめる
import { currentPool } from "@/db/drizzle/pool";
import { CompanyId, TeamId } from "@/db/ids";
import { purgeDeparted } from "@/src/lib/purge-departed";
import { reportError } from "@/src/lib/report-error";
import { emptyTeamListStore } from "@/src/services/__tests__/request";
import { sqliteStorage } from "@/src/services/__tests__/sqlite-storage";
import type { Env } from "../app";
import worker, {
  CompanyTeamListDurableObject,
  handler,
  sentryOptions,
} from "../worker";

vi.mock("@/src/lib/purge-departed", () => ({ purgeDeparted: vi.fn() }));

const sentry = vi.hoisted(() => ({
  withSentry: vi.fn((_options: unknown, wrapped: unknown) => wrapped),
  captureException: vi.fn(),
  httpServerIntegration: vi.fn((options: unknown) => ({
    name: "HttpServer",
    options,
  })),
  consoleIntegration: vi.fn((options: unknown) => ({
    name: "Console",
    options,
  })),
}));
vi.mock("@sentry/cloudflare", () => sentry);
// 各 test の後の restoreAllMocks が呼び出しの記録を消すので、import の時の呼び出しを先に控える
const withSentryCallsAtImport = [...sentry.withSentry.mock.calls];

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
  CF_VERSION_METADATA: { id: "v1" },
  COMPANY_TEAM_LIST: { getByName: () => emptyTeamListStore() },
});

const failingBinding = () =>
  vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));

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

it("定期処理の照合は taimei-auth の Service Binding へ送る", async () => {
  vi.mocked(purgeDeparted).mockResolvedValue(PURGE_REPORT);
  const binding = failingBinding();
  await handler.scheduled({}, envWithBinding(binding), collectingContext().ctx);
  const [{ checkMemberships }] = vi.mocked(purgeDeparted).mock.calls[0];

  await checkMemberships({ companyId: "cmp_a", userIds: ["u_1"] }).catch(
    () => undefined,
  );

  expect(binding).toHaveBeenCalledOnce();
});

it("Worker の fetch は cookie の session を taimei-auth の binding で確かめ、確かめられなければ 401 で、1 回報告する", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sentry.captureException.mockClear();
  const binding = failingBinding();
  const { ctx, waited } = collectingContext();

  const response = await handler.fetch(
    new Request("http://app.example/api/me", {
      headers: { Cookie: buildSessionCookieHeader("tok") },
    }),
    envWithBinding(binding),
    ctx,
  );
  await Promise.all(waited);

  expect(response.status).toBe(401);
  expect(binding).toHaveBeenCalledOnce();
  expect(sentry.captureException).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      message: "taimei-auth で session を確かめられなかった",
    }),
  );
  expect(waited).toHaveLength(1);
});

it("定期処理は purgeDeparted の結果を 1 回 console.info に出す", async () => {
  vi.mocked(purgeDeparted).mockResolvedValue(PURGE_REPORT);
  const info = vi.spyOn(console, "info").mockImplementation(() => {});

  await handler.scheduled({}, envWithBinding(), collectingContext().ctx);

  expect(info).toHaveBeenCalledExactlyOnceWith("purge-departed", PURGE_REPORT);
});

it("Sentry の options は DSN を env から渡す", () => {
  expect(
    sentryOptions({ ...envWithBinding(), SENTRY_DSN: "https://dsn" }).dsn,
  ).toBe("https://dsn");
});

it("Sentry の SDK は書き込みの body を読まず、console の breadcrumb を作らない", () => {
  expect(sentryOptions(envWithBinding()).integrations).toEqual([
    { name: "HttpServer", options: { maxRequestBodySize: "none" } },
    { name: "Console", options: { levels: [] } },
  ]);
});

it("Worker の入口は handler を withSentry で包み、options に sentryOptions を渡す", () => {
  expect(withSentryCallsAtImport).toHaveLength(1);
  const [options, wrapped] = withSentryCallsAtImport[0];
  expect(options).toBe(sentryOptions);
  expect(wrapped).toBe(handler);
  expect(worker).toBe(handler);
});

it("Worker の入口は、報告した値を Sentry の captureException に渡す", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sentry.captureException.mockClear();
  const error = new Error("boom");

  reportError(error);

  expect(sentry.captureException).toHaveBeenCalledExactlyOnceWith(error);
});

type SentryOptions = ReturnType<typeof sentryOptions>;
type ErrorEvent = Parameters<NonNullable<SentryOptions["beforeSend"]>>[0];
const { beforeSend } = sentryOptions(envWithBinding());
const sentEvent = async (event: Omit<ErrorEvent, "type">) =>
  beforeSend?.({ ...event, type: undefined }, {});

it("Sentry に送る失敗の message から SQL の params を消し、SQL と params の無い message は残す", async () => {
  const pgMessage =
    'duplicate key value violates unique constraint "teams_company_id_name_key"';
  const failure = new DrizzleQueryError(
    "insert into teams (name) values ($1)",
    ["秘密のチーム名"],
  );

  const sent = await sentEvent({
    exception: {
      values: [
        { type: "DatabaseError", value: pgMessage },
        { type: "Error", value: failure.message },
      ],
    },
  });

  const [cause, query] = sent?.exception?.values ?? [];
  expect(cause?.value).toBe(pgMessage);
  expect(query?.value).toContain("insert into teams");
  expect(query?.value).not.toContain("秘密のチーム名");
});

it("exception の無い event は、そのまま送る", async () => {
  expect(await sentEvent({ message: "boom" })).toEqual({
    type: undefined,
    message: "boom",
  });
});

it("message の無い失敗の値は、そのまま送る", async () => {
  const sent = await sentEvent({ exception: { values: [{ type: "Error" }] } });

  expect(sent?.exception?.values).toEqual([{ type: "Error" }]);
});

it("Worker の module が export する DO は、事業所のチーム一覧を置き・読み・消す", () => {
  const teamList = new CompanyTeamListDurableObject(
    { storage: { sql: sqliteStorage() } },
    {},
  );
  const snapshot = {
    version: 1,
    teams: [
      {
        id: TeamId.make(crypto.randomUUID()),
        name: "開発",
        assignedUserIds: [],
      },
    ],
  };

  expect(teamList.read("v1")).toBeUndefined();
  teamList.replace("v1", snapshot);
  expect(teamList.read("v1")).toEqual(snapshot);
  teamList.clear();
  expect(teamList.read("v1")).toBeUndefined();
});

it("定期処理が purgeDeparted に渡す teamListOf は、その事業所の名前の DO の一覧を返す", async () => {
  vi.mocked(purgeDeparted).mockResolvedValue(PURGE_REPORT);
  const store = emptyTeamListStore();
  const replace = vi.spyOn(store, "replace");
  const getByName = vi.fn(() => store);
  await handler.scheduled(
    {},
    { ...envWithBinding(), COMPANY_TEAM_LIST: { getByName } },
    collectingContext().ctx,
  );
  const [{ teamListOf }] = vi.mocked(purgeDeparted).mock.calls[0];

  await Effect.runPromise(
    teamListOf(CompanyId.make("cmp_x")).replace({ version: 2, teams: [] }),
  );

  expect(getByName).toHaveBeenCalledExactlyOnceWith("cmp_x");
  expect(replace).toHaveBeenCalledExactlyOnceWith("v1", {
    version: 2,
    teams: [],
  });
});
