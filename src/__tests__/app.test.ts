import { readFileSync } from "node:fs";
import { buildAuthLoginUrl } from "@taimei-code/auth-client";
import { asc, eq } from "drizzle-orm";
import { type Schema, SchemaAST } from "effect";
import { HttpApi } from "effect/http-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import type { TeamId } from "@/db/ids";
import { sendErrorReportsTo } from "@/src/lib/report-error";
import {
  seedAssignment,
  seedLevel,
  seedSkill,
  seedTeam,
  teamName,
} from "@/src/services/__tests__/db/seed";
import {
  dbInRollback,
  type TestDb,
  withRollbackDb,
} from "@/src/services/__tests__/db/test-db";
import { emptyTeamListStore } from "@/src/services/__tests__/request";
import type { TeamListStore } from "@/src/services/team-list-store";
import {
  Authenticated,
  MAX_LEVEL_ENTRIES_PER_SAVE,
  OperationFailure,
  SpaApi,
} from "@/src/spa-contract";
import { app, type Env } from "../app";

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
let cacheNames: string[];
let cacheStores: Map<string, TeamListStore>;
const envWithBinding = (fetch: typeof binding): Env => {
  binding = fetch;
  return {
    AUTH: { fetch: binding },
    AUTH_URL,
    HYPERDRIVE: { connectionString: "unused" },
    CF_VERSION_METADATA: { id: "v1" },
    COMPANY_TEAM_LIST: {
      getByName: (name) => {
        cacheNames.push(name);
        const store = cacheStores.get(name) ?? emptyTeamListStore();
        cacheStores.set(name, store);
        return store;
      },
    },
  };
};

const envWith = (response: () => Response | Promise<Response>) =>
  envWithBinding(vi.fn<typeof fetch>(async () => response()));

const envWithRole = (role: NonNullable<SessionOptions["role"]>) =>
  envWith(() => sessionOk({ role }));

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

const sendSameOriginRequest = (
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  env: Env,
  body?: string,
  contentType = "application/json",
) =>
  app.request(
    `${ORIGIN}${path}`,
    {
      method,
      headers: {
        ...COOKIE,
        Origin: ORIGIN,
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      body,
    },
    env,
  );

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

const DECODE_FAILURE = "本文の無い decode の失敗";

const failureBodyOf = async (response: Response) => {
  const text = await response.text();
  return text === "" ? undefined : JSON.parse(text);
};

const expectedFailureBody = (tag: string) =>
  tag === DECODE_FAILURE ? undefined : expect.objectContaining({ _tag: tag });

const locationOf = (response: Response) =>
  new URL(response.headers.get("Location") ?? "");

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  cacheNames = [];
  cacheStores = new Map();
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
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "taimei-auth で session を確かめられなかった",
      }),
    );
    expect(consoleError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe("session と Worker の version の印", () => {
  it.each(["/api/me", "/api/teams"])(
    "%s の応答に、事業所と user の id と Worker の version を x-taimei-session で付ける",
    (path) =>
      withRollbackDb(async () => {
        const response = await get(path, envWithRole("ROLE_OWNER"));

        expect(response.status).toBe(200);
        expect(response.headers.get("x-taimei-session")).toBe(
          "cmp_app_a u_1 v1",
        );
      }),
  );

  it("要求の印が今の session と違う (別のタブで事業所を切り替えた) と、書き込まずに 409 を返し、今の印を付ける", () =>
    withRollbackDb(async (tx) => {
      const response = await app.request(
        `${ORIGIN}/api/teams`,
        {
          method: "POST",
          headers: {
            ...COOKIE,
            Origin: ORIGIN,
            "Content-Type": "application/json",
            "x-taimei-session": "cmp_app_b u_1 v1",
          },
          body: JSON.stringify({ name: "開発" }),
        },
        envWithRole("ROLE_OWNER"),
      );

      expect(response.status).toBe(409);
      expect(response.headers.get("x-taimei-session")).toBe("cmp_app_a u_1 v1");
      expect(await teamRows(tx)).toEqual([]);
    }));

  it("要求の印が deploy の前の Worker の version なら (deploy の前に開いたタブ)、書き込まずに 409 を返し、今の印を付ける", () =>
    withRollbackDb(async (tx) => {
      const response = await app.request(
        `${ORIGIN}/api/teams`,
        {
          method: "POST",
          headers: {
            ...COOKIE,
            Origin: ORIGIN,
            "Content-Type": "application/json",
            "x-taimei-session": "cmp_app_a u_1 v0",
          },
          body: JSON.stringify({ name: "開発" }),
        },
        envWithRole("ROLE_OWNER"),
      );

      expect(response.status).toBe(409);
      expect(response.headers.get("x-taimei-session")).toBe("cmp_app_a u_1 v1");
      expect(await teamRows(tx)).toEqual([]);
    }));

  it("要求の印が今の session と同じなら、そのまま処理する", () =>
    withRollbackDb(async () => {
      const response = await get("/api/me", envWithRole("ROLE_OWNER"), {
        ...COOKIE,
        "x-taimei-session": "cmp_app_a u_1 v1",
      });

      expect(response.status).toBe(200);
    }));
});

describe("全ての route の認証", () => {
  const PUBLIC_ENDPOINTS = [
    "GET /auth",
    "GET /auth/after-signin",
    "GET /auth/after-signup",
    "GET /auth/account",
    "GET /auth/account/members",
  ];
  const CSRF_MIDDLEWARE = `ALL ${EVERY_PATH}`;
  const nonPublicRoutes = routes.filter(
    (r) => ![...PUBLIC_ENDPOINTS, CSRF_MIDDLEWARE].includes(routeKey(r)),
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
        "POST /api/teams",
        "GET /api/teams/:teamId",
        "PATCH /api/teams/:teamId",
        "DELETE /api/teams/:teamId",
        "PUT /api/teams/:teamId/my-levels",
        "POST /api/teams/:teamId/skills",
        "DELETE /api/skills/:skillId",
        "PUT /api/teams/:teamId/assignments/:userId",
        "DELETE /api/teams/:teamId/assignments/:userId",
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
      expect(response.headers.get("x-taimei-session")).toBeNull();
      expect(binding).not.toHaveBeenCalled();
    },
  );
});

// reflect は失敗の schema を状態コードの注釈を付けて包むので、class の値ではなく identifier で比べる
const identifierOf = (schema: Schema.Top) =>
  SchemaAST.resolveIdentifier(schema.ast);

describe("契約の endpoint", () => {
  const endpoints: {
    key: string;
    middleware: ReadonlySet<unknown>;
    errorIdentifiers: (string | undefined)[];
  }[] = [];
  HttpApi.reflect(SpaApi, {
    onGroup: () => {},
    onEndpoint: ({ endpoint, middleware, errors }) => {
      endpoints.push({
        key: `${endpoint.method} ${endpoint.path}`,
        middleware,
        errorIdentifiers: [...errors.values()].flat().map(identifierOf),
      });
    },
  });

  it("path と method は今の SPA の API の 12 本", () => {
    expect(endpoints.map(({ key }) => key).sort()).toEqual(
      [
        "GET /api/me",
        "GET /api/teams",
        "POST /api/teams",
        "GET /api/teams/:teamId",
        "PATCH /api/teams/:teamId",
        "DELETE /api/teams/:teamId",
        "POST /api/teams/:teamId/skills",
        "DELETE /api/skills/:skillId",
        "PUT /api/teams/:teamId/assignments/:userId",
        "DELETE /api/teams/:teamId/assignments/:userId",
        "PUT /api/teams/:teamId/my-levels",
        "GET /api/members",
      ].sort(),
    );
  });

  it("全ての endpoint に認証の middleware が掛かる", () => {
    expect(
      endpoints
        .filter(({ middleware }) => !middleware.has(Authenticated))
        .map(({ key }) => key),
    ).toEqual([]);
  });

  const declaredFailures = [
    ...OperationFailure.members,
    ...Authenticated.error,
  ];

  it("全ての endpoint の失敗は、SPA が文言を持つ OperationFailure か認証の middleware の失敗", () => {
    const declared = declaredFailures.map(identifierOf);

    expect(
      endpoints.flatMap(({ key, errorIdentifiers }) =>
        errorIdentifiers
          .filter((identifier) => !declared.includes(identifier))
          .map((identifier) => `${key} ${identifier}`),
      ),
    ).toEqual([]);
  });

  it("契約の失敗は全て 500 でない状態コードを持つ (本文の無い 500 は予期しない失敗だけ)", () => {
    expect(
      declaredFailures
        .filter(({ ast }) => {
          const status = ast.annotations?.httpApiStatus;
          return typeof status !== "number" || status === 500;
        })
        .map(identifierOf),
    ).toEqual([]);
  });

  it("cookie 付きでも契約に無い /api の path は 404", async () => {
    const response = await get("/api/unknown", envWith(sessionOk));

    expect(response.status).toBe(404);
  });

  it("処理の途中で client が切った要求は報告しない", async () => {
    const abort = new AbortController();
    vi.spyOn(dbInRollback, "execute").mockImplementation(() => {
      abort.abort();
      return new Promise(() => {}) as never;
    });

    const pending = app.request(
      `${ORIGIN}/api/teams`,
      { headers: COOKIE, signal: abort.signal },
      envWithRole("ROLE_OWNER"),
    );
    await Promise.resolve(pending).catch(() => undefined);

    expect(dbInRollback.execute).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });
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

  it("purge-departed は毎時 17 分の Cron Trigger で動く", () => {
    expect(wranglerConfig.triggers?.crons).toEqual(["17 * * * *"]);
  });

  it("本番は app.taimei-code.com の custom domain だけで受ける", () => {
    expect(wranglerConfig.routes).toEqual([
      { pattern: "app.taimei-code.com", custom_domain: true },
    ]);
  });

  it("session の cookie が届かない workers.dev では受けない", () => {
    expect(wranglerConfig.workers_dev).toBe(false);
  });

  it("session の cookie が届かない版ごとの preview の URL では受けない", () => {
    expect(wranglerConfig.preview_urls).toBe(false);
  });

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
  it("session の事業所のチームだけを、契約の schema に無い割り当ての user id を落として id と name で、transaction を開かず 1 文で返す", () =>
    withRollbackDb(async (tx) => {
      const db = spyOnDb();
      const a = await seedTeam(tx, "cmp_app_a", "A のチーム");
      await seedAssignment(tx, "cmp_app_a", a, "u_other");
      await seedTeam(tx, "cmp_app_b", "B のチーム");

      const response = await get("/api/teams", envWithRole("ROLE_OWNER"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        teams: [{ id: a, name: "A のチーム" }],
      });
      expect(db.execute).toHaveBeenCalledOnce();
      expect(db.transaction).not.toHaveBeenCalled();
    }));

  it("DB に接続できないと 500 で本文を返さず、原因を 1 回報告する", async () => {
    vi.spyOn(dbInRollback, "execute").mockRejectedValue(
      new Error("Failed query", {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      }),
    );

    const response = await get("/api/teams", envWithRole("ROLE_OWNER"));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "Failed query" }),
    );
  });
});

describe("チーム一覧の DO", () => {
  const listedNames = async (response: Response) =>
    ((await response.json()) as { teams: { name: string }[] }).teams.map(
      (team) => team.name,
    );

  it("一覧は session の事業所の名前の DO だけを呼ぶ", () =>
    withRollbackDb(async (tx) => {
      await seedAssignedTeam(tx);

      await get("/api/teams", envWithRole("ROLE_OWNER"));

      expect(cacheNames.length).toBeGreaterThan(0);
      expect(new Set(cacheNames)).toEqual(new Set(["cmp_app_a"]));
    }));

  it("星取表・自分の情報・メンバー一覧は DO を呼ばない", () =>
    withRollbackDb(async (tx) => {
      const { teamId } = await seedAssignedTeam(tx);
      const env = envWithMembers(() => membersOk([]));

      const statuses = [
        (await get(`/api/teams/${teamId}`, env)).status,
        (await get("/api/me", env)).status,
        (await get("/api/members", env)).status,
      ];

      expect(statuses).toEqual([200, 200, 200]);
      expect(cacheNames).toEqual([]);
    }));

  it("一覧を DO に置いた後にレベルを保存しても、次の一覧は DB を読まない", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      const env = envWithMembers(() => membersOk([]), { role: "ROLE_MEMBER" });
      await get("/api/teams", env);
      const saved = await sendSameOriginRequest(
        "PUT",
        `/api/teams/${teamId}/my-levels`,
        env,
        JSON.stringify({ levels: [{ skillId, level: 3, wantsToLearn: true }] }),
      );
      const db = spyOnDb();

      const response = await get("/api/teams", env);

      expect(saved.status).toBe(200);
      expect(await listedNames(response)).toEqual(["開発"]);
      expect(db.execute).not.toHaveBeenCalled();
    }));

  it("一覧を DO に置いた後に管理者がチームを作ると、次の一覧は DB を読まずに新しいチームを含む", () =>
    withRollbackDb(async () => {
      const env = envWithRole("ROLE_OWNER");
      await get("/api/teams", env);
      const created = await sendSameOriginRequest(
        "POST",
        "/api/teams",
        env,
        JSON.stringify({ name: "新しいチーム" }),
      );
      const db = spyOnDb();

      const response = await get("/api/teams", env);

      expect(created.status).toBe(200);
      expect(await listedNames(response)).toContain("新しいチーム");
      expect(db.execute).not.toHaveBeenCalled();
    }));

  it("一覧を DO に置いた後に割り当てを外すと、外されたメンバーの次の一覧にそのチームは無い", () =>
    withRollbackDb(async (tx) => {
      const { teamId } = await seedAssignedTeam(tx);
      const memberEnv = envWithMembers(() => membersOk([]), {
        role: "ROLE_MEMBER",
      });
      const managerEnv = envWithRole("ROLE_OWNER");
      expect(await listedNames(await get("/api/teams", memberEnv))).toEqual([
        "開発",
      ]);

      const unassigned = await sendSameOriginRequest(
        "DELETE",
        `/api/teams/${teamId}/assignments/u_1`,
        managerEnv,
      );
      const response = await get("/api/teams", memberEnv);

      expect(unassigned.status).toBe(200);
      expect(await listedNames(response)).toEqual([]);
    }));
});

describe("route の defect", () => {
  afterEach(() => sendErrorReportsTo(() => {}));

  it("本体の defect は 500 で本文を返さず、defect を 1 回報告する", async () => {
    const send = vi.fn();
    sendErrorReportsTo(send);
    // 戻り値の rows を読む所で TypeError になり、Effect の失敗ではなく defect になる
    vi.spyOn(dbInRollback, "execute").mockResolvedValue(undefined as never);

    const response = await get("/api/teams", envWithRole("ROLE_OWNER"));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBeInstanceOf(TypeError);
  });
});

const seedAssignedTeam = async (tx: TestDb) => {
  const teamId = await seedTeam(tx, "cmp_app_a", "開発");
  const skillId = await seedSkill(tx, "cmp_app_a", teamId, "設計");
  await seedAssignment(tx, "cmp_app_a", teamId, "u_1");
  return { teamId, skillId };
};

describe("GET /api/teams/:teamId", () => {
  const seedTeamPage = async (tx: TestDb) => {
    const { teamId, skillId } = await seedAssignedTeam(tx);
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

  it("deploy で Worker の version が変わると、前の version が置いた値を使わず DB から読む", () =>
    withRollbackDb(async (tx) => {
      const id = await seedTeam(tx, "cmp_app_a", "前の名前");
      const before = envWithRole("ROLE_OWNER");
      const after: Env = {
        ...envWithRole("ROLE_OWNER"),
        CF_VERSION_METADATA: { id: "v2" },
      };
      await get("/api/teams", before);
      await tx.update(teams).set({ name: "後の名前" }).where(eq(teams.id, id));
      const db = spyOnDb();

      const response = await get("/api/teams", after);

      expect(db.execute).toHaveBeenCalled();
      expect(await response.json()).toEqual({
        teams: [{ id, name: "後の名前" }],
      });
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
        teamId: other,
      });
      expect(consoleError).not.toHaveBeenCalled();
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
        expect.objectContaining({
          message: "listMembers failed: UNSPECIFIED",
        }),
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

const levelRows = (tx: TestDb) =>
  tx
    .select({
      companyId: memberSkills.companyId,
      skillId: memberSkills.skillId,
      userId: memberSkills.userId,
      level: memberSkills.level,
      wantsToLearn: memberSkills.wantsToLearn,
    })
    .from(memberSkills)
    .orderBy(asc(memberSkills.userId), asc(memberSkills.skillId));

describe("PUT /api/teams/:teamId/my-levels", () => {
  const putMyLevels = (
    teamId: string,
    body: string,
    env: Env,
    contentType = "application/json",
  ) =>
    sendSameOriginRequest(
      "PUT",
      `/api/teams/${teamId}/my-levels`,
      env,
      body,
      contentType,
    );

  const levelsBody = (
    levels: readonly {
      skillId: string;
      level: unknown;
      wantsToLearn: boolean;
      userId?: string;
    }[],
  ) => JSON.stringify({ levels });

  it("割り当てられた人の保存は、事業所スコープの transaction の中で自分の行に入り、200 の {} を返す", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      const db = spyOnDb();

      const response = await putMyLevels(
        teamId,
        levelsBody([{ skillId, level: 3, wantsToLearn: true }]),
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await levelRows(tx)).toEqual([
        {
          companyId: "cmp_app_a",
          skillId,
          userId: "u_1",
          level: 3,
          wantsToLearn: true,
        },
      ]);
      expect(db.transaction).toHaveBeenCalledOnce();
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("body に同僚の user id を足しても、書くのは送った人の行だけで、同僚の行は変わらない", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      await seedAssignment(tx, "cmp_app_a", teamId, "u_2");
      await seedLevel(tx, {
        companyId: "cmp_app_a",
        teamId,
        skillId,
        userId: "u_2",
        level: 1,
      });

      const response = await putMyLevels(
        teamId,
        levelsBody([{ skillId, level: 3, wantsToLearn: true, userId: "u_2" }]),
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(200);
      expect(await levelRows(tx)).toMatchObject([
        { userId: "u_1", level: 3, wantsToLearn: true },
        { userId: "u_2", level: 1, wantsToLearn: false },
      ]);
    }));

  it("割り当てられていない管理者は 403 で、行を書かない", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "開発");
      const skillId = await seedSkill(tx, "cmp_app_a", teamId, "設計");

      const response = await putMyLevels(
        teamId,
        levelsBody([{ skillId, level: 2, wantsToLearn: false }]),
        envWithRole("ROLE_ADMIN"),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        _tag: "NotAssigned",
      });
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("別のチームのスキルを含めると 404 で、どの行も書かない", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      const otherTeamId = await seedTeam(tx, "cmp_app_a", "営業");
      const otherSkillId = await seedSkill(
        tx,
        "cmp_app_a",
        otherTeamId,
        "提案",
      );

      const response = await putMyLevels(
        teamId,
        levelsBody([
          { skillId, level: 2, wantsToLearn: false },
          { skillId: otherSkillId, level: 2, wantsToLearn: false },
        ]),
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        _tag: "SkillNotFound",
      });
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("範囲外のレベル (4) を含めると 422 で、どの行も書かない", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      const otherSkillId = await seedSkill(tx, "cmp_app_a", teamId, "テスト");

      const response = await putMyLevels(
        teamId,
        levelsBody([
          { skillId, level: 2, wantsToLearn: false },
          { skillId: otherSkillId, level: 4, wantsToLearn: false },
        ]),
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        _tag: "InvalidLevel",
      });
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("他社のチームは 404 で、他社の行は変わらない", () =>
    withRollbackDb(async (tx) => {
      const otherTeamId = await seedTeam(tx, "cmp_app_b", "他社");
      const otherSkillId = await seedSkill(
        tx,
        "cmp_app_b",
        otherTeamId,
        "設計",
      );
      await seedAssignment(tx, "cmp_app_b", otherTeamId, "u_1");
      await seedLevel(tx, {
        companyId: "cmp_app_b",
        teamId: otherTeamId,
        skillId: otherSkillId,
        userId: "u_1",
        level: 1,
      });

      const response = await putMyLevels(
        otherTeamId,
        levelsBody([{ skillId: otherSkillId, level: 3, wantsToLearn: true }]),
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ _tag: "TeamNotFound" });
      expect(await levelRows(tx)).toMatchObject([
        { companyId: "cmp_app_b", level: 1, wantsToLearn: false },
      ]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it.each([
    ["レベルを文字列にした body", "2", "application/json", 400, ""],
    [
      "Content-Type が JSON でない要求",
      2,
      "text/plain",
      415,
      "Unsupported content-type: text/plain",
    ],
  ])("%s は %i で、行を書かない", (_, level, contentType, status, body) =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);

      const response = await putMyLevels(
        teamId,
        levelsBody([{ skillId, level, wantsToLearn: false }]),
        envWithRole("ROLE_MEMBER"),
        contentType,
      );

      expect(response.status).toBe(status);
      expect(await response.text()).toBe(body);
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }),
  );

  it.each([
    [MAX_LEVEL_ENTRIES_PER_SAVE + 1, 400],
    [MAX_LEVEL_ENTRIES_PER_SAVE, 422],
  ])("%i 件の entry を送ると %i で、行を書かない", (count, status) =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);

      const response = await putMyLevels(
        teamId,
        levelsBody(
          Array.from({ length: count }, () => ({
            skillId,
            level: 2,
            wantsToLearn: false,
          })),
        ),
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(status);
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }),
  );

  it("壊れた JSON は 400 で、行を書かない", () =>
    withRollbackDb(async (tx) => {
      const { teamId } = await seedAssignedTeam(tx);

      const response = await putMyLevels(
        teamId,
        "{",
        envWithRole("ROLE_MEMBER"),
      );

      expect(response.status).toBe(400);
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }));
});

const teamRows = (tx: TestDb) =>
  tx
    .select({ id: teams.id, companyId: teams.companyId, name: teams.name })
    .from(teams)
    .orderBy(asc(teams.name));

describe("POST /api/teams", () => {
  it.each(["ROLE_OWNER", "ROLE_ADMIN"] as const)(
    "%s は名前の前後の空白を除いてチームを作り、事業所スコープの transaction の中で書いて、200 の { id } を返す",
    (role) =>
      withRollbackDb(async (tx) => {
        const db = spyOnDb();

        const response = await sendSameOriginRequest(
          "POST",
          "/api/teams",
          envWithRole(role),
          JSON.stringify({ name: "  開発  " }),
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual({ id: expect.any(String) });
        expect(await teamRows(tx)).toEqual([
          { id: body.id, companyId: "cmp_app_a", name: "開発" },
        ]);
        expect(db.transaction).toHaveBeenCalledOnce();
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );

  it.each([
    ["メンバー", 403, "NotManager", "ROLE_MEMBER", { name: "営業" }],
    ["空白だけの名前", 422, "InvalidName", "ROLE_ADMIN", { name: "   " }],
    [
      "51 文字の名前",
      422,
      "InvalidName",
      "ROLE_ADMIN",
      { name: "あ".repeat(51) },
    ],
    [
      "同じ事業所にある名前",
      409,
      "DuplicateName",
      "ROLE_ADMIN",
      { name: " 開発 " },
    ],
    ["name が数の body", 400, DECODE_FAILURE, "ROLE_ADMIN", { name: 1 }],
    ["name の無い body", 400, DECODE_FAILURE, "ROLE_ADMIN", {}],
  ] as const)(
    "%s は %i の %s で、チームを作らない",
    (_, status, tag, role, body) =>
      withRollbackDb(async (tx) => {
        await seedTeam(tx, "cmp_app_a", "開発");

        const response = await sendSameOriginRequest(
          "POST",
          "/api/teams",
          envWithRole(role),
          JSON.stringify(body),
        );

        expect(response.status).toBe(status);
        expect(await failureBodyOf(response)).toEqual(expectedFailureBody(tag));
        expect(await teamRows(tx)).toMatchObject([{ name: "開発" }]);
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );

  it("50 文字の名前は作れる", () =>
    withRollbackDb(async (tx) => {
      const name = "あ".repeat(50);

      const response = await sendSameOriginRequest(
        "POST",
        "/api/teams",
        envWithRole("ROLE_ADMIN"),
        JSON.stringify({ name }),
      );

      expect(response.status).toBe(200);
      expect(await teamRows(tx)).toMatchObject([{ name }]);
    }));
});

describe("PATCH /api/teams/:teamId", () => {
  it("管理者は名前の前後の空白を除いて名前を変え、事業所スコープの transaction の中で書いて、200 の {} を返す", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "旧");
      const db = spyOnDb();

      const response = await sendSameOriginRequest(
        "PATCH",
        `/api/teams/${teamId}`,
        envWithRole("ROLE_ADMIN"),
        JSON.stringify({ name: "  新  " }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await teamName(tx, teamId)).toBe("新");
      expect(db.transaction).toHaveBeenCalledOnce();
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it.each([
    ["メンバー", 403, "NotManager", "ROLE_MEMBER", "cmp_app_a", { name: "新" }],
    [
      "他社のチーム",
      404,
      "TeamNotFound",
      "ROLE_ADMIN",
      "cmp_app_b",
      { name: "新" },
    ],
    [
      "空白だけの名前",
      422,
      "InvalidName",
      "ROLE_ADMIN",
      "cmp_app_a",
      { name: "   " },
    ],
    [
      "name が数の body",
      400,
      DECODE_FAILURE,
      "ROLE_ADMIN",
      "cmp_app_a",
      { name: 1 },
    ],
    [
      "同じ事業所の別のチームの名前",
      409,
      "DuplicateName",
      "ROLE_ADMIN",
      "cmp_app_a",
      { name: "開発" },
    ],
  ] as const)(
    "%s は %i の %s で、名前を変えない",
    (_, status, tag, role, companyId, body) =>
      withRollbackDb(async (tx) => {
        await seedTeam(tx, "cmp_app_a", "開発");
        const teamId = await seedTeam(tx, companyId, "旧");

        const response = await sendSameOriginRequest(
          "PATCH",
          `/api/teams/${teamId}`,
          envWithRole(role),
          JSON.stringify(body),
        );

        expect(response.status).toBe(status);
        expect(await failureBodyOf(response)).toEqual(expectedFailureBody(tag));
        expect(await teamName(tx, teamId)).toBe("旧");
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );
});

describe("DELETE /api/teams/:teamId", () => {
  const deleteTeam = (teamId: string, env: Env) =>
    sendSameOriginRequest("DELETE", `/api/teams/${teamId}`, env);

  const seedTeamWithSkillAssignmentAndLevel = async (
    tx: TestDb,
    companyId: string,
  ) => {
    const teamId = await seedTeam(
      tx,
      companyId,
      `チーム ${crypto.randomUUID()}`,
    );
    const skillId = await seedSkill(tx, companyId, teamId, "設計");
    await seedAssignment(tx, companyId, teamId, "u_1");
    await seedLevel(tx, { companyId, teamId, skillId, userId: "u_1" });
    return teamId;
  };

  const rowCountsOfTeam = async (tx: TestDb, teamId: TeamId) =>
    Promise.all(
      [
        teams.id,
        skills.teamId,
        teamAssignments.teamId,
        memberSkills.teamId,
      ].map(
        async (column) =>
          (await tx.select().from(column.table).where(eq(column, teamId)))
            .length,
      ),
    );

  it("管理者はチームを消し、そのスキル・割り当て・記入も消え、同じ事業所の別のチームは残る", () =>
    withRollbackDb(async (tx) => {
      const deleted = await seedTeamWithSkillAssignmentAndLevel(
        tx,
        "cmp_app_a",
      );
      const kept = await seedTeamWithSkillAssignmentAndLevel(tx, "cmp_app_a");

      const response = await deleteTeam(deleted, envWithRole("ROLE_ADMIN"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await rowCountsOfTeam(tx, deleted)).toEqual([0, 0, 0, 0]);
      expect(await rowCountsOfTeam(tx, kept)).toEqual([1, 1, 1, 1]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it.each([
    ["メンバー", 403, "NotManager", "ROLE_MEMBER", "cmp_app_a"],
    ["他社のチーム", 404, "TeamNotFound", "ROLE_ADMIN", "cmp_app_b"],
  ] as const)(
    "%s は %i の %s で、チームを消さない",
    (_, status, tag, role, companyId) =>
      withRollbackDb(async (tx) => {
        const teamId = await seedTeamWithSkillAssignmentAndLevel(tx, companyId);

        const response = await deleteTeam(teamId, envWithRole(role));

        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ _tag: tag });
        expect(await rowCountsOfTeam(tx, teamId)).toEqual([1, 1, 1, 1]);
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );
});

const skillNamesOf = async (tx: TestDb, teamId: TeamId) =>
  (
    await tx
      .select({ name: skills.name })
      .from(skills)
      .where(eq(skills.teamId, teamId))
      .orderBy(asc(skills.name))
  ).map((row) => row.name);

describe("POST /api/teams/:teamId/skills", () => {
  const addSkill = (teamId: string, env: Env, body: unknown) =>
    sendSameOriginRequest(
      "POST",
      `/api/teams/${teamId}/skills`,
      env,
      JSON.stringify(body),
    );

  it("管理者は名前の前後の空白を除いてスキルを足し、200 の {} を返す", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "開発");

      const response = await addSkill(teamId, envWithRole("ROLE_ADMIN"), {
        name: "  設計  ",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await skillNamesOf(tx, teamId)).toEqual(["設計"]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it.each([
    [
      "メンバー",
      403,
      "NotManager",
      "ROLE_MEMBER",
      "cmp_app_a",
      { name: "テスト" },
    ],
    [
      "チームにある名前",
      409,
      "DuplicateName",
      "ROLE_ADMIN",
      "cmp_app_a",
      { name: " 設計 " },
    ],
    [
      "51 文字の名前",
      422,
      "InvalidName",
      "ROLE_ADMIN",
      "cmp_app_a",
      { name: "あ".repeat(51) },
    ],
    [
      "他社のチーム",
      404,
      "TeamNotFound",
      "ROLE_ADMIN",
      "cmp_app_b",
      { name: "テスト" },
    ],
    ["name の無い body", 400, DECODE_FAILURE, "ROLE_ADMIN", "cmp_app_a", {}],
  ] as const)(
    "%s は %i の %s で、スキルを足さない",
    (_, status, tag, role, companyId, body) =>
      withRollbackDb(async (tx) => {
        const teamId = await seedTeam(tx, companyId, "開発");
        await seedSkill(tx, companyId, teamId, "設計");

        const response = await addSkill(teamId, envWithRole(role), body);

        expect(response.status).toBe(status);
        expect(await failureBodyOf(response)).toEqual(expectedFailureBody(tag));
        expect(await skillNamesOf(tx, teamId)).toEqual(["設計"]);
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );

  it("50 文字の名前は足せる", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "開発");
      const name = "あ".repeat(50);

      const response = await addSkill(teamId, envWithRole("ROLE_ADMIN"), {
        name,
      });

      expect(response.status).toBe(200);
      expect(await skillNamesOf(tx, teamId)).toEqual([name]);
    }));
});

describe("DELETE /api/skills/:skillId", () => {
  const removeSkill = (skillId: string, env: Env) =>
    sendSameOriginRequest("DELETE", `/api/skills/${skillId}`, env);

  it("管理者はスキルを消し、そのスキルの記入も消え、同じチームの別のスキルは残る", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      await seedSkill(tx, "cmp_app_a", teamId, "実装");
      await seedLevel(tx, {
        companyId: "cmp_app_a",
        teamId,
        skillId,
        userId: "u_1",
      });

      const response = await removeSkill(skillId, envWithRole("ROLE_ADMIN"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await skillNamesOf(tx, teamId)).toEqual(["実装"]);
      expect(await levelRows(tx)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it.each([
    ["メンバー", 403, "NotManager", "ROLE_MEMBER", "cmp_app_a"],
    ["他社のスキル", 404, "SkillNotFound", "ROLE_ADMIN", "cmp_app_b"],
  ] as const)(
    "%s は %i の %s で、スキルを消さない",
    (_, status, tag, role, companyId) =>
      withRollbackDb(async (tx) => {
        const teamId = await seedTeam(tx, companyId, "開発");
        const skillId = await seedSkill(tx, companyId, teamId, "設計");

        const response = await removeSkill(skillId, envWithRole(role));

        expect(response.status).toBe(status);
        expect(await failureBodyOf(response)).toEqual(expectedFailureBody(tag));
        expect(await skillNamesOf(tx, teamId)).toEqual(["設計"]);
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );

  it("UUID でない id は 404 の SkillNotFound", () =>
    withRollbackDb(async () => {
      const response = await removeSkill(
        "not-a-uuid",
        envWithRole("ROLE_ADMIN"),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ _tag: "SkillNotFound" });
    }));
});

const assignedUserIdsOf = async (tx: TestDb, teamId: TeamId) =>
  (
    await tx
      .select({ userId: teamAssignments.userId })
      .from(teamAssignments)
      .where(eq(teamAssignments.teamId, teamId))
      .orderBy(asc(teamAssignments.userId))
  ).map((row) => row.userId);

const companyMember = (userId: string) => ({
  userId,
  name: `名前 ${userId}`,
  email: `${userId}@example.com`,
  role: "ROLE_MEMBER",
});

describe("PUT /api/teams/:teamId/assignments/:userId", () => {
  const assign = (teamId: string, userId: string, env: Env) =>
    sendSameOriginRequest(
      "PUT",
      `/api/teams/${teamId}/assignments/${userId}`,
      env,
    );

  it("管理者は事業所のメンバーを割り当て、200 の {} を返す", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "開発");

      const response = await assign(
        teamId,
        "u_2",
        envWithMembers(() => membersOk([companyMember("u_2")]), {
          role: "ROLE_ADMIN",
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await assignedUserIdsOf(tx, teamId)).toEqual(["u_2"]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it("割り当て済みの人をもう一度割り当てても 200 で、割り当ては 1 つのまま", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "開発");
      await seedAssignment(tx, "cmp_app_a", teamId, "u_2");

      const response = await assign(
        teamId,
        "u_2",
        envWithMembers(() => membersOk([companyMember("u_2")]), {
          role: "ROLE_ADMIN",
        }),
      );

      expect(response.status).toBe(200);
      expect(await assignedUserIdsOf(tx, teamId)).toEqual(["u_2"]);
    }));

  it.each([
    [
      "メンバー一覧に居ない人",
      422,
      "NotCompanyMember",
      "ROLE_ADMIN",
      "cmp_app_a",
      () => membersOk([companyMember("u_3")]),
    ],
    [
      "メンバー",
      403,
      "NotManager",
      "ROLE_MEMBER",
      "cmp_app_a",
      () => membersOk([companyMember("u_2")]),
    ],
    [
      "他社のチーム",
      404,
      "TeamNotFound",
      "ROLE_ADMIN",
      "cmp_app_b",
      () => membersOk([companyMember("u_2")]),
    ],
    [
      "メンバー一覧の RPC が session の失敗を返す時",
      401,
      "Unauthenticated",
      "ROLE_ADMIN",
      "cmp_app_a",
      sessionError,
    ],
  ] as const)(
    "%s は %i の %s で、割り当てず報告しない",
    (_, status, tag, role, companyId, list) =>
      withRollbackDb(async (tx) => {
        const teamId = await seedTeam(tx, companyId, "開発");

        const response = await assign(
          teamId,
          "u_2",
          envWithMembers(list, { role }),
        );

        expect(response.status).toBe(status);
        expect(await failureBodyOf(response)).toEqual(expectedFailureBody(tag));
        expect(await assignedUserIdsOf(tx, teamId)).toEqual([]);
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );

  it("メンバー一覧が取れないと 500 で本文を返さず、割り当てず listMembers failed を 1 回報告する", () =>
    withRollbackDb(async (tx) => {
      const teamId = await seedTeam(tx, "cmp_app_a", "開発");

      const response = await assign(
        teamId,
        "u_2",
        envWithMembers(
          () => Response.json({ error: { reason: "RESULT_UNSPECIFIED" } }),
          { role: "ROLE_ADMIN" },
        ),
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("");
      expect(await assignedUserIdsOf(tx, teamId)).toEqual([]);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "listMembers failed: UNSPECIFIED",
        }),
      );
    }));
});

describe("DELETE /api/teams/:teamId/assignments/:userId", () => {
  const unassign = (teamId: string, userId: string, env: Env) =>
    sendSameOriginRequest(
      "DELETE",
      `/api/teams/${teamId}/assignments/${userId}`,
      env,
    );

  it("管理者は割り当てを外し、その人の記入も消え、同じチームの別の人の割り当ては残る", () =>
    withRollbackDb(async (tx) => {
      const { teamId, skillId } = await seedAssignedTeam(tx);
      await seedAssignment(tx, "cmp_app_a", teamId, "u_2");
      for (const userId of ["u_1", "u_2"])
        await seedLevel(tx, {
          companyId: "cmp_app_a",
          teamId,
          skillId,
          userId,
        });

      const response = await unassign(teamId, "u_2", envWithRole("ROLE_ADMIN"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await assignedUserIdsOf(tx, teamId)).toEqual(["u_1"]);
      expect(await levelRows(tx)).toMatchObject([{ userId: "u_1" }]);
      expect(consoleError).not.toHaveBeenCalled();
    }));

  it.each([
    ["メンバー", 403, "NotManager", "ROLE_MEMBER", "cmp_app_a"],
    ["他社のチーム", 404, "TeamNotFound", "ROLE_ADMIN", "cmp_app_b"],
  ] as const)(
    "%s は %i の %s で、割り当てを外さない",
    (_, status, tag, role, companyId) =>
      withRollbackDb(async (tx) => {
        const teamId = await seedTeam(tx, companyId, "開発");
        await seedAssignment(tx, companyId, teamId, "u_2");

        const response = await unassign(teamId, "u_2", envWithRole(role));

        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ _tag: tag });
        expect(await assignedUserIdsOf(tx, teamId)).toEqual(["u_2"]);
        expect(consoleError).not.toHaveBeenCalled();
      }),
  );
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
  ])("%s と 500 で本文を返さず、1 回報告する", async (_, list) => {
    const response = await get("/api/members", envWithMembers(list));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "listMembers failed: UNSPECIFIED",
      }),
    );
  });

  it("一覧の RPC が session の失敗を返すと 401 で、報告しない", async () => {
    const response = await get("/api/members", envWithMembers(sessionError));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ _tag: "Unauthenticated" });
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

  it("別の origin の form の POST を止めた 403 は報告しない", async () => {
    const response = await formRequest("https://evil.example", {
      path: "/api/teams",
      method: "POST",
      type: "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(403);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("同じ origin の form の POST は CSRF で止めない", async () => {
    const response = await formRequest(ORIGIN, {
      path: "/api/teams",
      method: "POST",
      type: "application/x-www-form-urlencoded",
    });

    expect(response.status).toBe(401);
  });

  it.each(endpointPaths)(
    "%s への別の origin からの preflight に Access-Control-Allow-Origin を付けない",
    async (path) => {
      const response = await app.request(
        `${ORIGIN}${path}`,
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        },
        envWith(sessionOk),
      );

      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    },
  );

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
  it("/auth の route の defect は 500 の Internal Server Error で、1 回報告する", async () => {
    const response = await get("/auth/account", {
      ...envWith(sessionOk),
      AUTH_URL: "not a url",
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
    expect(consoleError).toHaveBeenCalledOnce();
  });

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
