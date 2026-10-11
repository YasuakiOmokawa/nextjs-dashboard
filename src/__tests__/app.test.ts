import { readFileSync } from "node:fs";
import { buildAuthLoginUrl } from "@taimei-code/auth-client";
import { Effect, Result, Schema } from "effect";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyId } from "@/db/ids";
import { type RequestSession, runServiceWithoutDb } from "@/src/services";
import {
  seedAssignment,
  seedLevel,
  seedSkill,
  seedTeam,
} from "@/src/services/__tests__/db/seed";
import {
  dbInRollback,
  type TestDb,
  withRollbackDb,
} from "@/src/services/__tests__/db/test-db";
import { CompanyMembers } from "@/src/services/company-members-service";
import { TeamNotFound } from "@/src/services/team-errors";
import { app, type Env } from "../app";
import { resultJson } from "../run-json";

vi.mock("@/db/drizzle/client", async () => ({
  db: (await import("@/src/services/__tests__/db/test-db")).dbInRollback,
}));

const ORIGIN = "http://app.example";
const AUTH_URL = "https://auth.example";
const COOKIE = { Cookie: "better-auth.session_token=tok" };

type SessionOptions = {
  companyId?: string;
  role?: "ROLE_OWNER" | "ROLE_ADMIN" | "ROLE_MEMBER";
  createdAt?: string;
};

const sessionOk = ({
  companyId = "cmp_app_a",
  role,
  createdAt = "2026-10-10T00:00:00.000Z",
}: SessionOptions = {}) =>
  Response.json({
    ok: {
      user: {
        id: "u_1",
        name: "山田 花子",
        email: "hanako@example.com",
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
        defaultCompanyId: companyId || undefined,
      },
      session: { id: "s_1", expiresAt: "2099-01-01T00:00:00.000Z" },
      currentRole: role,
    },
  });

const sessionError = () =>
  Response.json({ error: { reason: "RESULT_SESSION_NOT_FOUND" } });

let binding: ReturnType<typeof vi.fn<typeof fetch>>;
const envWithBinding = (fetch: typeof binding): Env => {
  binding = fetch;
  return {
    AUTH: { fetch: binding },
    AUTH_URL,
    HYPERDRIVE: { connectionString: "unused" },
  };
};

const envWith = (response: () => Response | Promise<Response>) =>
  envWithBinding(vi.fn<typeof fetch>(async () => response()));

const envWithMembers = (list: () => Response, session: SessionOptions = {}) =>
  envWithBinding(
    vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/VerifySession") ? sessionOk(session) : list(),
    ),
  );

const membersOk = (
  members: readonly Record<string, string>[],
  companyId = "cmp_app_a",
) => Response.json({ ok: { companyId, members } });

const get = (path: string, env: Env, headers: HeadersInit = COOKIE) =>
  app.request(`${ORIGIN}${path}`, { headers }, env);

const EVERY_PATH = "/*";
const routes = [
  ...new Map(
    app.routes.map(({ method, path }) => [
      `${method} ${path}`,
      { method, path },
    ]),
  ).values(),
];
const routeKey = (r: (typeof routes)[number]) => `${r.method} ${r.path}`;
const requestMethod = (method: string) => (method === "ALL" ? "GET" : method);
const pathWithParamsFilled = (path: string) => path.replace(/:[^/]+|\*/g, "x");

const locationOf = (response: Response) =>
  new URL(response.headers.get("Location") ?? "");

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("/api の session", () => {
  it("事業所の無い session は 401", async () => {
    const response = await get(
      "/api/teams",
      envWith(() => sessionOk({ companyId: "" })),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ _tag: "Unauthenticated" });
  });

  it("taimei-auth が session の失敗を返すと 401", async () => {
    const response = await get("/api/teams", envWith(sessionError));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ _tag: "Unauthenticated" });
  });

  it("taimei-auth に届かないと 401 で、1 回報告する", async () => {
    const response = await get(
      "/api/teams",
      envWith(() => {
        throw new Error("connection refused");
      }),
    );

    expect(response.status).toBe(401);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("全ての route の認証", () => {
  const PUBLIC_ENDPOINTS = [
    "GET /auth",
    "GET /auth/after-signin",
    "GET /auth/after-signup",
    "GET /auth/account",
    "GET /auth/account/members",
  ];
  const nonPublicRoutes = routes.filter(
    (r) => !PUBLIC_ENDPOINTS.includes(routeKey(r)),
  );

  it("公開の口は全て route にある", () => {
    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining(PUBLIC_ENDPOINTS),
    );
  });

  it("公開でない route がある", () => {
    expect(nonPublicRoutes.map(routeKey)).toEqual(
      expect.arrayContaining([
        "GET /api/me",
        "GET /api/teams",
        "GET /api/teams/:teamId",
        "GET /api/members",
      ]),
    );
  });

  it.each(PUBLIC_ENDPOINTS)(
    "%s は cookie 無しでも 401 にしない",
    async (key) => {
      const [method, path] = key.split(" ");

      const response = await app.request(
        `${ORIGIN}${path}`,
        { method },
        envWith(sessionError),
      );

      expect(response.status).not.toBe(401);
    },
  );

  it.each(nonPublicRoutes)(
    "$method $path は cookie 無しで 401",
    async (route) => {
      const env = envWith(sessionOk);

      const response = await app.request(
        `${ORIGIN}${pathWithParamsFilled(route.path)}`,
        { method: requestMethod(route.method), headers: { Origin: ORIGIN } },
        env,
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ _tag: "Unauthenticated" });
      expect(binding).not.toHaveBeenCalled();
    },
  );
});

describe("Worker に届く path", () => {
  const wranglerConfig = JSON.parse(
    readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n"),
  );
  const runWorkerFirst: string[] = wranglerConfig.assets.run_worker_first;
  const reachesWorker = (path: string) =>
    runWorkerFirst.some((pattern) =>
      pattern.endsWith("*")
        ? path.startsWith(pattern.slice(0, -1))
        : path === pattern,
    );

  it("全ての route の path は run_worker_first に当たる", () => {
    expect(
      routes
        .map((r) => r.path)
        .filter((path) => path !== EVERY_PATH)
        .filter((path) => !reachesWorker(pathWithParamsFilled(path))),
    ).toEqual([]);
  });
});

const spyOnDb = () => ({
  execute: vi.spyOn(dbInRollback, "execute"),
  transaction: vi.spyOn(dbInRollback, "transaction"),
});

describe("GET /api/teams", () => {
  it("session の事業所のチームだけを id と name で、transaction を開かず 1 文で返す", () =>
    withRollbackDb(async (tx) => {
      const db = spyOnDb();
      const a = await seedTeam(tx, "cmp_app_a", "A のチーム");
      await seedTeam(tx, "cmp_app_b", "B のチーム");

      const response = await get(
        "/api/teams",
        envWith(() => sessionOk({ role: "ROLE_OWNER" })),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        teams: [{ id: a, name: "A のチーム" }],
      });
      expect(db.execute).toHaveBeenCalledOnce();
      expect(db.transaction).not.toHaveBeenCalled();
    }));

  it("DB に接続できないと 503 を返し、1 回報告する", async () => {
    vi.spyOn(dbInRollback, "execute").mockRejectedValue(
      new Error("Failed query", {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      }),
    );

    const response = await get(
      "/api/teams",
      envWith(() => sessionOk({ role: "ROLE_OWNER" })),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "DbUnavailable",
      message: "保存に失敗しました",
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("GET /api/teams/:teamId", () => {
  const seedTeamPage = async (tx: TestDb) => {
    const teamId = await seedTeam(tx, "cmp_app_a", "開発");
    const skillId = await seedSkill(tx, "cmp_app_a", teamId, "設計");
    await seedAssignment(tx, "cmp_app_a", teamId, "u_1");
    await seedLevel(tx, {
      companyId: "cmp_app_a",
      teamId,
      skillId,
      userId: "u_1",
      level: 2,
    });
    return { teamId, skillId };
  };

  it("チームと、星取表に要るメンバーの user id と名前だけを、transaction を開かず 1 文で返す", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedTeamPage(tx);
      const db = spyOnDb();

      const response = await get(
        `/api/teams/${teamId}`,
        envWithMembers(
          () =>
            membersOk([
              {
                userId: "u_1",
                name: "山田 花子",
                email: "hanako@example.com",
                role: "ROLE_MEMBER",
              },
              {
                userId: "u_2",
                name: " ",
                email: "taro@example.com",
                role: "ROLE_ADMIN",
              },
            ]),
          { role: "ROLE_MEMBER" },
        ),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        team: {
          id: teamId,
          name: "開発",
          skills: [{ id: skillId, name: "設計" }],
          assignedUserIds: ["u_1"],
          levels: [{ userId: "u_1", skillId, level: 2, wantsToLearn: false }],
        },
        members: [
          { userId: "u_1", name: "山田 花子" },
          { userId: "u_2", name: "taro@example.com" },
        ],
      });
      expect(db.execute).toHaveBeenCalledOnce();
      expect(db.transaction).not.toHaveBeenCalled();
    }));

  it("他社のチームは 404", () =>
    withRollbackDb(async (tx) => {
      const other = await seedTeam(tx, "cmp_app_b", "他社");

      const response = await get(
        `/api/teams/${other}`,
        envWithMembers(() => membersOk([])),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        _tag: "TeamNotFound",
        message: "チームが見つかりません",
      });
    }));

  it("メンバー一覧が取れなくてもチームを返し、一覧は null にして 1 回報告する", () =>
    withRollbackDb(async (tx) => {
      const { teamId } = await seedTeamPage(tx);

      const response = await get(
        `/api/teams/${teamId}`,
        envWithMembers(() =>
          Response.json({ error: { reason: "RESULT_UNSPECIFIED" } }),
        ),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        team: { id: teamId },
        members: null,
      });
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        "listMembers failed",
        expect.anything(),
      );
    }));

  it("メンバー一覧の RPC が session の失敗を返すと 401 で、報告しない", () =>
    withRollbackDb(async (tx) => {
      const { teamId } = await seedTeamPage(tx);

      const response = await get(
        `/api/teams/${teamId}`,
        envWithMembers(sessionError),
      );

      expect(response.status).toBe(401);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it(
    "チームの文がメンバー一覧の RPC の開始を待っても返る (直列なら timeout で落ちる)",
    () =>
      withRollbackDb(async (tx) => {
        const { teamId } = await seedTeamPage(tx);
        let markMembersRpcStarted = () => {};
        const membersRpcStarted = new Promise<void>((resolve) => {
          markMembersRpcStarted = resolve;
        });
        const execute = dbInRollback.execute;
        vi.spyOn(dbInRollback, "execute").mockImplementation(((query) =>
          membersRpcStarted.then(() => execute(query))) as typeof execute);
        const env = envWithBinding(
          vi.fn<typeof fetch>(async (input) => {
            if (String(input).endsWith("/VerifySession")) return sessionOk();
            markMembersRpcStarted();
            return membersOk([]);
          }),
        );

        const response = await get(`/api/teams/${teamId}`, env);

        expect(response.status).toBe(200);
      }),
    2_000,
  );

  it("UUID でない id は文を流さずに 404", () =>
    withRollbackDb(async () => {
      const db = spyOnDb();

      const response = await get(
        "/api/teams/not-a-uuid",
        envWithMembers(() => membersOk([])),
      );

      expect(response.status).toBe(404);
      expect(db.execute).not.toHaveBeenCalled();
    }));
});

describe("GET /api/members", () => {
  const rpcNames = () =>
    binding.mock.calls.map(([input]) => new URL(String(input)).pathname);

  it("名前・メールアドレス・role だけを返す", async () => {
    const response = await get(
      "/api/members",
      envWithMembers(() =>
        membersOk([
          {
            userId: "u_1",
            name: "山田 花子",
            email: "hanako@example.com",
            role: "ROLE_OWNER",
          },
        ]),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      members: [
        { name: "山田 花子", email: "hanako@example.com", role: "OWNER" },
      ],
    });
  });

  it.each([
    ["空白だけの名前はメールアドレスにする", "  ", "taro@example.com"],
    ["名前の前後の空白は除く", " 山田 ", "山田"],
  ])("%s", async (_, name, shown) => {
    const response = await get(
      "/api/members",
      envWithMembers(() =>
        membersOk([
          {
            userId: "u_2",
            name,
            email: "taro@example.com",
            role: "ROLE_MEMBER",
          },
        ]),
      ),
    );

    expect((await response.json()).members[0].name).toBe(shown);
  });

  it("SDK が知らない role の人には role を載せない", async () => {
    const response = await get(
      "/api/members",
      envWithMembers(() =>
        membersOk([
          {
            userId: "u_2",
            name: "山田",
            email: "taro@example.com",
            role: "ROLE_UNSPECIFIED",
          },
        ]),
      ),
    );

    expect((await response.json()).members[0]).not.toHaveProperty("role");
  });

  it.each([
    ["role の無い", undefined],
    ["MEMBER の", "ROLE_MEMBER"],
  ] as const)(
    "%s session にも一覧を返す (taimei-auth は事業所のメンバーなら誰にでも返す)",
    async (_, role) => {
      const response = await get(
        "/api/members",
        envWithMembers(
          () =>
            membersOk([
              {
                userId: "u_2",
                name: "山田",
                email: "taro@example.com",
                role: "ROLE_ADMIN",
              },
            ]),
          { role },
        ),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).members).toHaveLength(1);
    },
  );

  it("session の確認と一覧の取得で taimei-auth を 2 回だけ呼ぶ", async () => {
    await get(
      "/api/members",
      envWithMembers(() => membersOk([])),
    );

    expect(rpcNames()).toEqual([
      "/rpc/auth.v1.AuthService/VerifySession",
      "/rpc/auth.v1.AuthService/ListCurrentCompanyMembers",
    ]);
  });

  it.each([
    [
      "一覧の RPC が失敗を返す",
      () => Response.json({ error: { reason: "RESULT_UNSPECIFIED" } }),
    ],
    ["一覧の事業所が session の事業所と違う", () => membersOk([], "cmp_app_b")],
  ])("%s と 502 で、1 回報告する", async (_, list) => {
    const response = await get("/api/members", envWithMembers(list));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      _tag: "MemberListError",
      message: "メンバー一覧を取得できませんでした",
    });
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      "listMembers failed",
      expect.anything(),
    );
  });

  it("一覧の RPC が session の失敗を返すと 401 で、報告しない", async () => {
    const response = await get("/api/members", envWithMembers(sessionError));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      _tag: "Unauthenticated",
      message: "ログインし直してください",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("GET /api/me", () => {
  it.each([
    ["ROLE_ADMIN", true],
    ["ROLE_MEMBER", false],
    [undefined, false],
  ] as const)(
    "role %s の canManage は %s で、user id・名前・canManage だけを返す",
    async (role, canManage) => {
      const response = await get(
        "/api/me",
        envWith(() => sessionOk({ role })),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        userId: "u_1",
        name: "山田 花子",
        canManage,
      });
    },
  );
});

describe("CSRF と CORS", () => {
  const FORM_CONTENT_TYPES = [
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
  ];
  const endpointPaths = [
    ...new Set(routes.map((r) => pathWithParamsFilled(r.path))),
  ];
  const stateChangingFormRequests = endpointPaths.flatMap((path) =>
    ["POST", "PUT", "PATCH", "DELETE"].flatMap((method) =>
      FORM_CONTENT_TYPES.map((type) => ({ path, method, type })),
    ),
  );

  const formRequest = (
    origin: string,
    { path, method, type }: (typeof stateChangingFormRequests)[number],
  ) =>
    app.request(
      `${ORIGIN}${path}`,
      { method, headers: { Origin: origin, "Content-Type": type }, body: "x" },
      envWith(sessionOk),
    );

  it("列挙は /api と /api の外の path を含む", () => {
    expect(endpointPaths).toEqual(
      expect.arrayContaining(["/api/teams", "/auth"]),
    );
  });

  it.each(stateChangingFormRequests)(
    "$method $path に別の origin から $type で送ると 403",
    async (request) => {
      const response = await formRequest("https://evil.example", request);

      expect(response.status).toBe(403);
    },
  );

  it("同じ origin の form の POST は CSRF で止めない", async () => {
    const response = await formRequest(ORIGIN, {
      path: "/api/teams",
      method: "POST",
      type: "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(401);
  });

  it("別の origin の GET にも Access-Control-Allow-Origin を付けない", async () => {
    const response = await get("/api/me", envWith(sessionOk), {
      ...COOKIE,
      Origin: "https://evil.example",
    });

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("/auth の着地", () => {
  const login = (callbackUrl?: string) => {
    const afterSignIn = new URL("/auth/after-signin", ORIGIN);
    if (callbackUrl) afterSignIn.searchParams.set("callbackUrl", callbackUrl);
    return buildAuthLoginUrl({
      authBaseUrl: AUTH_URL,
      service: "taimei",
      returnTo: afterSignIn.toString(),
      signUpUrl: `${ORIGIN}/auth/after-signup`,
    });
  };

  it("/auth は taimei-auth のログインへ", async () => {
    const response = await get("/auth", envWith(sessionOk));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(login());
  });

  it("/auth の callbackUrl はログイン後の着地に渡す", async () => {
    const response = await get(
      "/auth?callbackUrl=/dashboard/teams",
      envWith(sessionOk),
    );

    expect(locationOf(response).searchParams.get("redirect_url")).toBe(
      `${ORIGIN}/auth/after-signin?callbackUrl=%2Fdashboard%2Fteams`,
    );
  });

  it.each(["https://evil.example/x", "//evil.example/x"])(
    "別の origin の callbackUrl %s は捨てる",
    async (callbackUrl) => {
      const response = await get(
        `/auth?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        envWith(sessionOk),
      );

      expect(response.headers.get("Location")).toBe(login());
    },
  );

  it("callbackUrl を重ねた /auth は callbackUrl 無しと同じ", async () => {
    const response = await get(
      "/auth?callbackUrl=/a&callbackUrl=/b",
      envWith(sessionOk),
    );

    expect(response.headers.get("Location")).toBe(login());
  });

  it.each(["/.//evil.example/x", "/a/..//evil.example/x"])(
    "正規化すると // で始まる callbackUrl %s の after-signin は別の origin へ移さない",
    async (callbackUrl) => {
      const response = await get(
        `/auth/after-signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        envWith(sessionOk),
      );

      expect(response.headers.get("Location")).toBe(`${ORIGIN}/dashboard`);
    },
  );

  it("session の無い after-signin は signin_failed", async () => {
    const response = await get("/auth/after-signin", envWith(sessionError));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${AUTH_URL}/auth/error?reason=signin_failed`,
    );
  });

  it("事業所の無い after-signin は事業所の登録へ", async () => {
    const response = await get(
      "/auth/after-signin?callbackUrl=/dashboard/teams",
      envWith(() => sessionOk({ companyId: "" })),
    );

    const location = locationOf(response);
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      `${AUTH_URL}/auth/signup/company`,
    );
    expect(location.searchParams.get("service_name")).toBe("taimei");
    expect(location.searchParams.get("redirect_url")).toBe(
      `${ORIGIN}/dashboard/teams`,
    );
  });

  it("事業所のある after-signin は callbackUrl へ", async () => {
    const response = await get(
      "/auth/after-signin?callbackUrl=/dashboard/teams",
      envWith(sessionOk),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${ORIGIN}/dashboard/teams`);
  });

  it("callbackUrl を重ねた after-signin は /dashboard へ", async () => {
    const response = await get(
      "/auth/after-signin?callbackUrl=/a&callbackUrl=/b",
      envWith(sessionOk),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("callbackUrl の無い after-signin は /dashboard へ", async () => {
    const response = await get("/auth/after-signin", envWith(sessionOk));

    expect(response.headers.get("Location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("session の無い after-signup は signin_failed", async () => {
    const response = await get("/auth/after-signup", envWith(sessionError));

    expect(response.headers.get("Location")).toBe(
      `${AUTH_URL}/auth/error?reason=signin_failed`,
    );
  });

  it("createdAt が日時でない after-signup は signin_failed", async () => {
    const response = await get(
      "/auth/after-signup",
      envWith(() => sessionOk({ createdAt: "not a date" })),
    );

    expect(response.headers.get("Location")).toBe(
      `${AUTH_URL}/auth/error?reason=signin_failed`,
    );
  });

  const createdAt = "2026-10-10T00:00:00.000Z";
  const fiveMinutes = 5 * 60 * 1000;

  it("ちょうど 5 分前に作られた user の after-signup は signup_already_completed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(createdAt) + fiveMinutes);

    const response = await get(
      "/auth/after-signup",
      envWith(() => sessionOk({ createdAt })),
    );

    expect(response.headers.get("Location")).toBe(
      `${AUTH_URL}/auth/error?reason=signup_already_completed`,
    );
  });

  it("5 分前より 1 ms 新しい user の after-signup は /dashboard へ", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(createdAt) + fiveMinutes - 1);

    const response = await get(
      "/auth/after-signup",
      envWith(() => sessionOk({ createdAt })),
    );

    expect(response.headers.get("Location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("/auth/account は taimei-auth の /account へ", async () => {
    const response = await get("/auth/account", envWith(sessionOk));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${AUTH_URL}/account`);
  });
});

describe("GET /auth/account/members", () => {
  it("taimei-auth のメンバー画面へ、戻り先を /dashboard にして移す", async () => {
    const response = await get(
      "/auth/account/members",
      envWith(sessionError),
      {},
    );

    const location = locationOf(response);
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      `${AUTH_URL}/account/members`,
    );
    expect(location.searchParams.get("service_name")).toBe("taimei");
    expect(location.searchParams.get("redirect_url")).toBe(
      `${ORIGIN}/dashboard`,
    );
  });
});

describe("resultJson", () => {
  const session: RequestSession = {
    companyId: CompanyId.make("cmp_app_a"),
    userId: "u_1",
    role: undefined,
    userName: "山田 花子",
    companyMembers: CompanyMembers.of({ list: Effect.succeed([]) }),
  };

  it("失敗は表の状態コードと文言で返す", async () => {
    const response = await new Hono()
      .get("/x", async (c) =>
        resultJson(
          c,
          Schema.Struct({}),
          await runServiceWithoutDb(session, () =>
            Effect.fail(new TeamNotFound({ teamId: "t" })),
          ),
        ),
      )
      .request("/x");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "TeamNotFound",
      message: "チームが見つかりません",
    });
  });

  it("成功は schema に無い key を落として返す", async () => {
    const response = await new Hono()
      .get("/x", async (c) =>
        resultJson(
          c,
          Schema.Struct({ id: Schema.String }),
          await runServiceWithoutDb(session, () =>
            Effect.succeed({ id: "t", email: "leak@example.com" }),
          ),
        ),
      )
      .request("/x");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "t" });
  });

  it("実行口を通さない Result は型エラーになる (bun run typecheck で見る)", () => {
    new Hono().get("/x", (c) =>
      // @ts-expect-error 実行口 (runServiceWithoutDb・runScopedService) の結果だけを受ける
      resultJson(c, Schema.Struct({}), Result.succeed({})),
    );
  });
});
