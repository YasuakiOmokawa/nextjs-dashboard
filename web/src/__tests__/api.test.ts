import { QueryClient, queryOptions } from "@tanstack/react-query";
import { DetailedError } from "hono/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSkill,
  assignMember,
  deleteTeam,
  failureMessageOf,
  loadQuery,
  removeSkill,
  renameTeam,
  saveMyLevels,
  type TeamPage,
  teamQuery,
  unassignMember,
  writeSavedMyLevels,
} from "../api";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("保存の level に文字列を渡すと型エラーになる (bun run typecheck で見る)", () => {
  () =>
    // @ts-expect-error hc の入力の型は API の schema の JSON の形 (level は数)
    saveMyLevels("t", [{ skillId: "s", level: "2", wantsToLearn: false }]);
});

it.each([
  [
    "保存",
    () => saveMyLevels("../members", []),
    "/api/teams/..%2Fmembers/my-levels",
  ],
  [
    "名前の変更",
    () => renameTeam("../members", "x"),
    "/api/teams/..%2Fmembers",
  ],
  ["削除", () => deleteTeam("../members"), "/api/teams/..%2Fmembers"],
  [
    "スキルの追加",
    () => addSkill("../members", "x"),
    "/api/teams/..%2Fmembers/skills",
  ],
  ["スキルの削除", () => removeSkill("../me"), "/api/skills/..%2Fme"],
  [
    "割り当て",
    () => assignMember("../members", "a/b"),
    "/api/teams/..%2Fmembers/assignments/a%2Fb",
  ],
  [
    "外す",
    () => unassignMember("../members", "a/b"),
    "/api/teams/..%2Fmembers/assignments/a%2Fb",
  ],
])(
  "%s は path の param を escape して path に入れる",
  async (_, send, path) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
    vi.stubGlobal("fetch", fetch);

    await send();

    expect(String(fetch.mock.calls[0]?.[0])).toBe(path);
  },
);

const failedResponse = (data: unknown) =>
  new DetailedError("403 Forbidden", {
    statusCode: 403,
    detail: { data, statusText: "Forbidden" },
  });

it("失敗の文言は、API の本文の message", () => {
  expect(
    failureMessageOf(
      failedResponse({
        _tag: "NotAssigned",
        message: "チームに割り当てられた人だけが記入できます",
      }),
      "保存できませんでした",
    ),
  ).toBe("チームに割り当てられた人だけが記入できます");
});

it.each([
  [
    "Worker の外で起きた、本文が JSON でない 5xx",
    failedResponse("Internal Server Error"),
  ],
  ["本文に message の無い応答", failedResponse({ _tag: "NotAssigned" })],
  ["応答の無い網の失敗", new TypeError("Failed to fetch")],
])("%s の文言は、呼び手が渡した操作ごとの文言", (_, error) => {
  expect(failureMessageOf(error, "チームを削除できませんでした")).toBe(
    "チームを削除できませんでした",
  );
});

const TEAM_ID = "00000000-0000-4000-8000-0000000000aa";
const SKILL_ID = "00000000-0000-4000-8000-000000000001";

const pageWithMyLevel = (level: 0 | 1 | 2 | 3): TeamPage => ({
  team: {
    id: TEAM_ID,
    name: "開発",
    skills: [{ id: SKILL_ID, name: "設計" }],
    assignedUserIds: ["u_1"],
    levels: [{ userId: "u_1", skillId: SKILL_ID, level, wantsToLearn: false }],
  },
  members: [{ userId: "u_1", name: "山田 花子" }],
});

it("保存の前に始まったチームの取得が保存の後に返っても、cache は保存した値のまま", async () => {
  const queryClient = new QueryClient();
  const { queryKey } = teamQuery(TEAM_ID);
  queryClient.setQueryData(queryKey, pageWithMyLevel(1));
  const staleFetch = Promise.withResolvers<TeamPage>();
  const fetching = queryClient
    .query({ queryKey, queryFn: () => staleFetch.promise })
    .catch(() => undefined);

  await writeSavedMyLevels(queryClient, TEAM_ID, "u_1", [
    { skillId: SKILL_ID, level: 3, wantsToLearn: true },
  ]);
  staleFetch.resolve(pageWithMyLevel(1));
  await fetching;

  expect(queryClient.getQueryData(queryKey)?.team.levels).toEqual([
    { userId: "u_1", skillId: SKILL_ID, level: 3, wantsToLearn: true },
  ]);
});

describe("loadQuery", () => {
  it("cache の無い query は取得して、その結果で解決する", async () => {
    const queryFn = vi.fn(async () => "fetched");
    const options = queryOptions({ queryKey: ["n"], queryFn });

    await expect(loadQuery(new QueryClient(), options)).resolves.toBe(
      "fetched",
    );
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it("cache のある query は取り直しを待たずに cache で解決し、裏で 1 回取り直す", async () => {
    const queryClient = new QueryClient();
    const refetched = Promise.withResolvers<string>();
    const queryFn = vi.fn(() => refetched.promise);
    const options = queryOptions({ queryKey: ["s"], queryFn });
    queryClient.setQueryData(options.queryKey, "cached");

    await expect(loadQuery(queryClient, options)).resolves.toBe("cached");
    expect(queryFn).toHaveBeenCalledOnce();

    refetched.resolve("refetched");
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(options.queryKey)).toBe("refetched"),
    );
  });

  it("invalidate した query は取り直しを待ち、前の値で解決しない", async () => {
    const queryClient = new QueryClient();
    const options = queryOptions({
      queryKey: ["i"],
      queryFn: async () => "after-delete",
    });
    queryClient.setQueryData(options.queryKey, "before-delete");
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      refetchType: "none",
    });

    await expect(loadQuery(queryClient, options)).resolves.toBe("after-delete");
  });

  it("cache のある query は、裏の取り直しが失敗しても cache で解決し、失敗は query の error に残る", async () => {
    const queryClient = new QueryClient();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const options = queryOptions({
      queryKey: ["f"],
      queryFn: async (): Promise<string> => {
        throw new Error("offline");
      },
    });
    queryClient.setQueryData(options.queryKey, "cached");

    await expect(loadQuery(queryClient, options)).resolves.toBe("cached");
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(options.queryKey)?.status).toBe("error"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("API の共通の fetch", () => {
  const importApiWithNewModuleState = async () => {
    vi.resetModules();
    return import("../api");
  };

  const meResponse = (userId: string, session?: string) =>
    Response.json(
      { userId, name: "山田 花子", canManage: false },
      { headers: session ? { "x-taimei-session": session } : {} },
    );

  const stubLocation = () => {
    const location = {
      pathname: "/dashboard/teams",
      search: "?tab=1",
      assign: vi.fn(),
      reload: vi.fn(),
    };
    vi.stubGlobal("location", location);
    return location;
  };

  it("先行の fetch があれば、GET の同じ URL の 1 回目にその応答を使い、2 回目は fetch する", async () => {
    const { meQuery } = await importApiWithNewModuleState();
    const fetch = vi.fn(async () => meResponse("u_fetched"));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal(
      "taimeiEarlyFetches",
      new Map([["/api/me", Promise.resolve(meResponse("u_early"))]]),
    );

    const first = await new QueryClient().query(meQuery);

    expect(first.userId).toBe("u_early");
    expect(fetch).not.toHaveBeenCalled();

    const second = await new QueryClient().query(meQuery);

    expect(second.userId).toBe("u_fetched");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("先行の fetch があっても、同じ URL への GET でない要求は fetch し、先行の fetch を残す", async () => {
    const { createTeam } = await importApiWithNewModuleState();
    const fetch = vi.fn(async () => Response.json({ id: "t_created" }));
    vi.stubGlobal("fetch", fetch);
    const early = new Map([
      ["/api/teams", Promise.resolve(meResponse("u_early"))],
    ]);
    vi.stubGlobal("taimeiEarlyFetches", early);

    await expect(createTeam("開発")).resolves.toEqual({ id: "t_created" });

    expect(fetch).toHaveBeenCalledOnce();
    expect(early.has("/api/teams")).toBe(true);
  });

  it("別のタブで事業所や user を切り替えた後に session の値が最初に受けた値と変わると、前の session の cache を捨てるため再読み込みする", async () => {
    const { meQuery } = await importApiWithNewModuleState();
    const location = stubLocation();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(meResponse("u_1", "cmp_a u_1"))
        .mockResolvedValueOnce(meResponse("u_1", "cmp_b u_1")),
    );

    await new QueryClient().query(meQuery);
    void new QueryClient().query(meQuery);

    await vi.waitFor(() => expect(location.reload).toHaveBeenCalledOnce());
  });

  it("最初に受けた session の印を、その後の要求に付けて送る", async () => {
    const { meQuery } = await importApiWithNewModuleState();
    stubLocation();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      meResponse("u_1", "cmp_a u_1"),
    );
    vi.stubGlobal("fetch", fetch);

    await new QueryClient().query(meQuery);
    await new QueryClient().query(meQuery);

    const sentMarks = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-taimei-session"),
    );
    expect(sentMarks).toEqual([null, "cmp_a u_1"]);
  });

  it("session の値が同じなら、再読み込みしない", async () => {
    const { meQuery } = await importApiWithNewModuleState();
    const location = stubLocation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => meResponse("u_1", "cmp_a u_1")),
    );

    await new QueryClient().query(meQuery);
    await new QueryClient().query(meQuery);

    expect(location.reload).not.toHaveBeenCalled();
  });

  it("401 は、今の path と query を callbackUrl にしてログインへ移す", async () => {
    const { meQuery } = await importApiWithNewModuleState();
    const location = stubLocation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    void new QueryClient().query(meQuery);

    await vi.waitFor(() =>
      expect(location.assign).toHaveBeenCalledExactlyOnceWith(
        `/auth?callbackUrl=${encodeURIComponent("/dashboard/teams?tab=1")}`,
      ),
    );
  });
});
