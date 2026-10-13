import { scheduleTask } from "@effect/atom-react";
import { Cause, Effect, Exit, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillId, TeamId } from "../../../db/ids";
import {
  NotAssigned,
  TeamNotFound,
  type TeamPage,
} from "../../../src/spa-contract";
import {
  type ApiMutation,
  addSkill,
  assignMember,
  createTeam,
  deleteTeam,
  failureMessageOf,
  failureToShow,
  loadAtom,
  loadedValueOf,
  markStale,
  meAtom,
  membersAtom,
  mutationAtom,
  removeSkill,
  renameTeam,
  runApiMutation,
  saveMyLevels,
  teamAtom,
  teamsAtom,
  unassignMember,
  waitForRefetch,
  waitForValue,
  writeSavedMyLevels,
} from "../api";

const stubLocation = () => {
  const location = {
    origin: "http://app.example",
    pathname: "/dashboard/teams",
    search: "?tab=1",
    assign: vi.fn(),
    reload: vi.fn(),
  };
  vi.stubGlobal("location", location);
  return location;
};

let location: ReturnType<typeof stubLocation>;
let registry: AtomRegistry.AtomRegistry;
beforeEach(() => {
  location = stubLocation();
  registry = AtomRegistry.make();
});

afterEach(() => {
  registry.dispose();
  vi.unstubAllGlobals();
});

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

it("契約の失敗の文言は、SPA の表の文言", () => {
  expect(failureMessageOf(new NotAssigned(), "保存できませんでした")).toBe(
    "チームに割り当てられた人だけが記入できます",
  );
});

it.each([
  ["契約に無い失敗 (本文の無い 500 など)", new Error("500")],
  ["応答の無い網の失敗", new TypeError("Failed to fetch")],
  ["_tag だけ似せた値", { _tag: "NotAssigned" }],
])("%s の文言は、呼び手が渡した操作ごとの文言", (_, error) => {
  expect(failureMessageOf(error, "チームを削除できませんでした")).toBe(
    "チームを削除できませんでした",
  );
});

const sourceResolvedByTest = <A>() => {
  const fetchesInOrder: PromiseWithResolvers<Effect.Effect<A, Error>>[] = [];
  const atom = Atom.make(
    Effect.flatten(
      Effect.promise(() => {
        const fetch = Promise.withResolvers<Effect.Effect<A, Error>>();
        fetchesInOrder.push(fetch);
        return fetch.promise;
      }),
    ),
  ).pipe(Atom.setIdleTTL("5 minutes"));
  const loadInitialValue = async (value: A) => {
    const first = loadAtom(registry, atom);
    fetchesInOrder[0]?.resolve(Effect.succeed(value));
    await first;
  };
  return { atom, fetchesInOrder, loadInitialValue };
};

const settled = async <A>(promise: Promise<A>) => {
  let state: "pending" | "settled" = "pending";
  void promise.then(
    () => (state = "settled"),
    () => (state = "settled"),
  );
  await yieldToEventLoop();
  return state;
};

describe("loadAtom", () => {
  it("値の無い atom は、取得の完了まで解決せず、取得した値で解決する", async () => {
    const { atom, fetchesInOrder } = sourceResolvedByTest<string>();

    const loading = loadAtom(registry, atom);

    expect(await settled(loading)).toBe("pending");
    fetchesInOrder[0]?.resolve(Effect.succeed("fetched"));
    await expect(loading).resolves.toBe("fetched");
  });

  it("取得の済んだ atom は、取り直しを待たずに前の値で解決し、裏で 1 回取り直す", async () => {
    const { atom, fetchesInOrder, loadInitialValue } =
      sourceResolvedByTest<string>();
    await loadInitialValue("cached");

    await expect(loadAtom(registry, atom)).resolves.toBe("cached");
    expect(fetchesInOrder).toHaveLength(2);
  });

  it("裏で取り直している最中の atom は、取り直しを待たずに前の値で解決する", async () => {
    const { atom, loadInitialValue } = sourceResolvedByTest<string>();
    await loadInitialValue("cached");
    registry.refresh(atom);
    registry.get(atom);

    expect(await settled(loadAtom(registry, atom))).toBe("settled");
    await expect(loadAtom(registry, atom)).resolves.toBe("cached");
  });

  it("更新で古くした atom は、古くする前の値ではなく取り直した値で解決する", async () => {
    const { atom, fetchesInOrder, loadInitialValue } =
      sourceResolvedByTest<string>();
    await loadInitialValue("before-delete");
    markStale(registry, atom);

    const loading = loadAtom(registry, atom);
    fetchesInOrder.at(-1)?.resolve(Effect.succeed("after-delete"));

    await expect(loading).resolves.toBe("after-delete");
  });

  it("古くした atom を読む loader が取り直しを待つ間に次の loader が来ても、前の値を返さない", async () => {
    const { atom, fetchesInOrder, loadInitialValue } =
      sourceResolvedByTest<string>();
    await loadInitialValue("before-delete");
    markStale(registry, atom);
    const first = loadAtom(registry, atom);

    const second = loadAtom(registry, atom);
    fetchesInOrder.at(-1)?.resolve(Effect.succeed("after-delete"));

    await expect(Promise.all([first, second])).resolves.toEqual([
      "after-delete",
      "after-delete",
    ]);
  });

  it("裏の取り直しに失敗した atom は、取り直しを待たずに前の成功値で解決する", async () => {
    const { atom, fetchesInOrder, loadInitialValue } =
      sourceResolvedByTest<string>();
    await loadInitialValue("cached");
    registry.refresh(atom);
    const refetching = waitForRefetch(registry, atom);
    fetchesInOrder.at(-1)?.resolve(Effect.fail(new Error("offline")));
    await refetching;

    await expect(loadAtom(registry, atom)).resolves.toBe("cached");
  });

  it("取得に失敗した atom は、失敗を返さずに取り直し、その値で解決する", async () => {
    const { atom, fetchesInOrder } = sourceResolvedByTest<string>();
    const first = loadAtom(registry, atom);
    fetchesInOrder[0]?.resolve(Effect.fail(new Error("offline")));
    await first.catch(() => {});

    const loading = loadAtom(registry, atom);
    fetchesInOrder.at(-1)?.resolve(Effect.succeed("recovered"));

    await expect(loading).resolves.toBe("recovered");
    expect(fetchesInOrder).toHaveLength(2);
  });
});

describe("waitForValue", () => {
  it("取り直し中の atom は、取り直しが終わるまで解決せず、取り直した値で解決する", async () => {
    const { atom, fetchesInOrder, loadInitialValue } =
      sourceResolvedByTest<string>();
    await loadInitialValue("before");
    registry.refresh(atom);

    const waiting = waitForValue(registry, atom);

    expect(await settled(waiting)).toBe("pending");
    fetchesInOrder.at(-1)?.resolve(Effect.succeed("after"));
    await expect(waiting).resolves.toBe("after");
  });
});

describe("loadedValueOf", () => {
  it("裏の取り直しに失敗しても、前の成功値があればそれを返す", () => {
    const failed = AsyncResult.failure(Cause.fail(new Error("offline")), {
      previousSuccess: Option.some(AsyncResult.success("cached")),
    });

    expect(loadedValueOf(failed)).toBe("cached");
  });

  it("前の成功値が無ければ、その失敗を throw する", () => {
    const notFound = new TeamNotFound({ teamId: "t_1" });
    const failed = AsyncResult.failure<string, TeamNotFound>(
      Cause.fail(notFound),
    );

    expect(() => loadedValueOf(failed)).toThrow(notFound);
  });
});

describe("failureToShow", () => {
  it("中断だけで終わった更新は、画面に失敗を出さない", () => {
    expect(failureToShow(Exit.interrupt())).toBeUndefined();
  });

  it("契約に宣言した失敗は、その class の instance で画面に渡す", () => {
    const notFound = new TeamNotFound({ teamId: "t_1" });

    expect(failureToShow(Exit.fail(notFound))).toBe(notFound);
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

  const readMeTwice = async (api: typeof import("../api")) => {
    const first = await api.waitForValue(registry, api.meAtom);
    registry.refresh(api.meAtom);
    const second = api.waitForValue(registry, api.meAtom);
    return { first, second };
  };

  it("先行の fetch があれば、GET の同じ URL の 1 回目にその応答を使い、2 回目は fetch する", async () => {
    const api = await importApiWithNewModuleState();
    const fetch = vi.fn(async () => meResponse("u_fetched"));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal(
      "taimeiEarlyFetches",
      new Map([["/api/me", Promise.resolve(meResponse("u_early"))]]),
    );

    const { first, second } = await readMeTwice(api);

    expect(first.userId).toBe("u_early");
    expect((await second).userId).toBe("u_fetched");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("別のタブで事業所や user を切り替えた後に session の値が最初に受けた値と変わると、前の session の cache を捨てるため再読み込みする", async () => {
    const api = await importApiWithNewModuleState();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(meResponse("u_1", "cmp_a u_1"))
        .mockResolvedValueOnce(meResponse("u_1", "cmp_b u_1")),
    );

    void (await readMeTwice(api)).second;

    await vi.waitFor(() => expect(location.reload).toHaveBeenCalledOnce());
  });

  it("最初に受けた session の印を、その後の要求に付けて送る", async () => {
    const api = await importApiWithNewModuleState();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      meResponse("u_1", "cmp_a u_1"),
    );
    vi.stubGlobal("fetch", fetch);

    await (await readMeTwice(api)).second;

    const sentMarks = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("x-taimei-session"),
    );
    expect(sentMarks).toEqual([null, "cmp_a u_1"]);
  });

  it("session の値が同じなら、再読み込みしない", async () => {
    const api = await importApiWithNewModuleState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => meResponse("u_1", "cmp_a u_1")),
    );

    await (await readMeTwice(api)).second;

    expect(location.reload).not.toHaveBeenCalled();
  });

  it("401 は、今の path と query を callbackUrl にしてログインへ移す", async () => {
    const api = await importApiWithNewModuleState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    void api.waitForValue(registry, api.meAtom);

    await vi.waitFor(() =>
      expect(location.assign).toHaveBeenCalledExactlyOnceWith(
        `/auth?callbackUrl=${encodeURIComponent("/dashboard/teams?tab=1")}`,
      ),
    );
  });
});

it("画面の atom は、購読が無くなっても 5 分は cache に残る", () => {
  expect(
    [meAtom, teamsAtom, membersAtom, teamAtom("t_1")].map(
      (atom) => atom.idleTTL,
    ),
  ).toEqual([300_000, 300_000, 300_000, 300_000]);
});

describe("チームの atom に書いた、保存した自分のレベル", () => {
  const TEAM_ID = TeamId.make("00000000-0000-4000-8000-0000000000aa");
  const SKILL_ID = SkillId.make("00000000-0000-4000-8000-000000000001");
  const pageWithMyLevel = (level: 0 | 1 | 2 | 3): TeamPage => ({
    team: {
      id: TEAM_ID,
      name: "開発",
      skills: [{ id: SKILL_ID, name: "設計" }],
      assignedUserIds: ["u_1"],
      levels: [
        { userId: "u_1", skillId: SKILL_ID, level, wantsToLearn: false },
      ],
    },
    members: [{ userId: "u_1", name: "山田 花子" }],
  });
  const savedLevel3 = [
    { skillId: SKILL_ID, level: 3, wantsToLearn: true },
  ] as const;
  const levelsOf = () =>
    Option.map(
      AsyncResult.value(registry.get(teamAtom(TEAM_ID))),
      (page) => page.team.levels,
    );

  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  beforeEach(async () => {
    fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(pageWithMyLevel(1)),
    );
    vi.stubGlobal("fetch", fetch);
    await waitForValue(registry, teamAtom(TEAM_ID));
  });

  it("書くと、チームを取り直さずに保存した値を返す", () => {
    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);

    expect(levelsOf()).toEqual(
      Option.some([{ userId: "u_1", ...savedLevel3[0] }]),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("書いた後にチームを取り直すと、取り直した値を返す", async () => {
    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);
    fetch.mockImplementation(async () => Response.json(pageWithMyLevel(2)));

    registry.refresh(teamAtom(TEAM_ID));
    await waitForValue(registry, teamAtom(TEAM_ID));

    expect(levelsOf()).toEqual(
      Option.some([
        { userId: "u_1", skillId: SKILL_ID, level: 2, wantsToLearn: false },
      ]),
    );
  });

  it("書いた後の取り直しの間は、取り直す前の取得の値ではなく保存した値を返す", () => {
    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);
    fetch.mockImplementation(() => new Promise<Response>(() => {}));

    registry.refresh(teamAtom(TEAM_ID));
    registry.get(teamAtom(TEAM_ID));

    expect(levelsOf()).toEqual(
      Option.some([{ userId: "u_1", ...savedLevel3[0] }]),
    );
  });

  it("書いた後の取り直しが失敗しても、取り直す前の取得の値ではなく保存した値を返す", async () => {
    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);
    fetch.mockImplementation(async () => new Response(null, { status: 503 }));

    registry.refresh(teamAtom(TEAM_ID));
    await waitForRefetch(registry, teamAtom(TEAM_ID));

    expect(levelsOf()).toEqual(
      Option.some([{ userId: "u_1", ...savedLevel3[0] }]),
    );
  });

  it("書いた後の取り直しが失敗し、次の取り直しも失敗しても、保存した値を返す", async () => {
    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);
    fetch.mockImplementation(async () => new Response(null, { status: 503 }));

    for (const _ of [1, 2]) {
      registry.refresh(teamAtom(TEAM_ID));
      await waitForRefetch(registry, teamAtom(TEAM_ID));
    }

    expect(levelsOf()).toEqual(
      Option.some([{ userId: "u_1", ...savedLevel3[0] }]),
    );
  });

  it("保存の前に始まった取得が保存の後に返っても、保存した値を返し、保存の後に取り直した値で置き換える", async () => {
    const fetchBeforeSave = Promise.withResolvers<Response>();
    fetch.mockImplementationOnce(() => fetchBeforeSave.promise);
    const unmount = registry.mount(teamAtom(TEAM_ID));
    registry.refresh(teamAtom(TEAM_ID));
    fetch.mockImplementation(async () => Response.json(pageWithMyLevel(3)));

    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);
    const shownLevels = [levelsOf()];
    const stopRecording = registry.subscribe(teamAtom(TEAM_ID), () =>
      shownLevels.push(levelsOf()),
    );
    fetchBeforeSave.resolve(Response.json(pageWithMyLevel(1)));
    await vi.waitFor(() =>
      expect(levelsOf()).toEqual(
        Option.some([
          { userId: "u_1", skillId: SKILL_ID, level: 3, wantsToLearn: false },
        ]),
      ),
    );
    stopRecording();
    unmount();

    expect(
      shownLevels.map((levels) =>
        Option.map(levels, (entries) => entries.map(({ level }) => level)),
      ),
    ).not.toContainEqual(Option.some([1]));
  });

  it("書いた後に画面を離れて購読が無くなっても、cache に残る間は保存した値を返す", async () => {
    const unmount = registry.mount(teamAtom(TEAM_ID));
    writeSavedMyLevels(registry, TEAM_ID, "u_1", savedLevel3);
    unmount();
    await yieldToEventLoop();

    expect(levelsOf()).toEqual(
      Option.some([{ userId: "u_1", ...savedLevel3[0] }]),
    );
  });
});

const runMutation = <V, A, E>(mutation: ApiMutation<V, A, E>, variables: V) =>
  runApiMutation(registry, mutationAtom<A, E>(), mutation, variables);

describe("更新", () => {
  it.each([
    [
      "保存",
      () => runMutation(saveMyLevels("../members", "u_1"), []),
      "/api/teams/..%2Fmembers/my-levels",
    ],
    [
      "名前の変更",
      () => runMutation(renameTeam("../members"), "x"),
      "/api/teams/..%2Fmembers",
    ],
    [
      "削除",
      () => runMutation(deleteTeam("../members"), undefined),
      "/api/teams/..%2Fmembers",
    ],
    [
      "スキルの追加",
      () => runMutation(addSkill("../members"), "x"),
      "/api/teams/..%2Fmembers/skills",
    ],
    [
      "スキルの削除",
      () => runMutation(removeSkill("t_1"), "../me"),
      "/api/skills/..%2Fme",
    ],
    [
      "割り当て",
      () => runMutation(assignMember("../members"), "a/b"),
      "/api/teams/..%2Fmembers/assignments/a%2Fb",
    ],
    [
      "外す",
      () => runMutation(unassignMember("../members"), "a/b"),
      "/api/teams/..%2Fmembers/assignments/a%2Fb",
    ],
  ])(
    "%s は path の param を escape して path に入れる",
    async (_, send, path) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({}),
      );
      vi.stubGlobal("fetch", fetch);

      await send();

      expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe(path);
    },
  );

  it("先行の fetch があっても、同じ URL への GET でない要求は fetch し、先行の fetch を残す", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "t_created" }));
    vi.stubGlobal("fetch", fetch);
    const early = new Map([
      ["/api/teams", Promise.resolve(Response.json({ teams: [] }))],
    ]);
    vi.stubGlobal("taimeiEarlyFetches", early);

    await runMutation(createTeam, "開発");

    expect(fetch).toHaveBeenCalledOnce();
    expect(early.has("/api/teams")).toBe(true);
  });
});

describe("waitForRefetch", () => {
  it("取り直しの失敗は更新の失敗にせず (画面は前の成功値を出し続ける)、取り直しの終わりで解決する", async () => {
    const { atom, fetchesInOrder, loadInitialValue } =
      sourceResolvedByTest<string>();
    await loadInitialValue("before");
    registry.refresh(atom);

    const waiting = waitForRefetch(registry, atom);
    fetchesInOrder.at(-1)?.resolve(Effect.fail(new Error("offline")));

    await expect(waiting).resolves.toBeUndefined();
  });
});

it("保存の level に文字列を渡すと型エラーになる (bun run typecheck で見る)", () => {
  () =>
    runMutation(saveMyLevels("t", "u_1"), [
      // @ts-expect-error 契約の payload の型は JSON の形 (level は数)
      { skillId: SkillId.make("s"), level: "2", wantsToLearn: false },
    ]);
});

describe("runApiMutation", () => {
  const recordedAfterSuccess = vi.fn();
  const mutationWith = (send: () => Effect.Effect<string, Error>) => ({
    send,
    afterSuccess: recordedAfterSuccess,
  });
  afterEach(() => {
    recordedAfterSuccess.mockClear();
  });

  it("成功すると、更新の後の処理 (古くする・取り直す) を、変数と結果を渡して終えてから解決する", async () => {
    const afterSuccessDone = vi.fn();
    recordedAfterSuccess.mockImplementation(() =>
      yieldToEventLoop().then(afterSuccessDone),
    );

    const exit = await runApiMutation(
      registry,
      mutationAtom<string, Error>(),
      mutationWith(() => Effect.succeed("ok")),
      "x",
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(recordedAfterSuccess).toHaveBeenCalledWith(registry, "x", "ok");
    expect(afterSuccessDone).toHaveBeenCalledOnce();
  });

  it("失敗すると、更新の後の処理を走らせない", async () => {
    const exit = await runApiMutation(
      registry,
      mutationAtom<string, Error>(),
      mutationWith(() => Effect.fail(new Error("NotManager"))),
      "x",
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(recordedAfterSuccess).not.toHaveBeenCalled();
  });

  it("同じ endpoint の更新を 2 つの画面の部品から同時に流しても、互いを中断せず、それぞれの結果で解決する", async () => {
    const first = Promise.withResolvers<string>();
    const exits = Promise.all([
      runApiMutation(
        registry,
        mutationAtom<string, Error>(),
        mutationWith(() => Effect.promise(() => first.promise)),
        "a",
      ),
      runApiMutation(
        registry,
        mutationAtom<string, Error>(),
        mutationWith(() => Effect.succeed("b")),
        "b",
      ),
    ]);
    await yieldToEventLoop();
    first.resolve("a");

    expect(
      (await exits).map((exit) => Exit.isSuccess(exit) && exit.value),
    ).toEqual(["a", "b"]);
  });
});

describe("一覧を古くする更新", () => {
  it("一覧を表示している間にチームを作っても一覧を取り直さず、次に一覧を開く時に取り直しを待つ", async () => {
    const createdTeam = {
      id: "00000000-0000-4000-8000-0000000000bb",
      name: "開発",
    };
    let teamsOnServer: (typeof createdTeam)[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method !== "POST")
        return Response.json({ teams: teamsOnServer });
      teamsOnServer = [createdTeam];
      return Response.json({ id: createdTeam.id });
    });
    vi.stubGlobal("fetch", fetch);
    const unmountList = registry.mount(teamsAtom);
    await loadAtom(registry, teamsAtom);
    const listGets = () =>
      fetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET")
        .length;

    await runMutation(createTeam, "開発");
    await yieldToEventLoop();

    expect(listGets()).toBe(1);
    unmountList();
    await expect(loadAtom(registry, teamsAtom)).resolves.toEqual({
      teams: [createdTeam],
    });
  });
});

it("@effect/atom-react が React の scheduler で組む task は、入っている scheduler で走り、取り消せる (peer の範囲外の scheduler 0.28 を入れている)", async () => {
  const ran = vi.fn();
  const cancelled = vi.fn();

  scheduleTask(ran);
  scheduleTask(cancelled)();
  await vi.waitFor(() => expect(ran).toHaveBeenCalledOnce());

  expect(cancelled).not.toHaveBeenCalled();
});
