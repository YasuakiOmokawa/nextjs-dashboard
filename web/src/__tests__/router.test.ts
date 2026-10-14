import { readFileSync } from "node:fs";
import { createMemoryHistory, isRedirect } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../router";

const indexHtml = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);
const earlyFetchScript = [
  ...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g),
]
  .map(([, script]) => script)
  .find((script) => script.includes("taimeiEarlyFetches"));
if (!earlyFetchScript)
  throw new Error("web/index.html に taimeiEarlyFetches を作る script が無い");

const TEAM_ID = "11111111-1111-4111-8111-111111111111";

const responseOf = (path: string) =>
  Response.json(
    path === "/api/me"
      ? { userId: "u_1", name: "山田 花子", canManage: true }
      : path === "/api/teams"
        ? { teams: [] }
        : path === "/api/members"
          ? { members: [] }
          : {
              team: {
                id: TEAM_ID,
                name: "開発",
                skills: [],
                assignedUserIds: [],
                levels: [],
              },
              members: null,
            },
  );

const fetchByPath = async (input: RequestInfo | URL) =>
  responseOf(new URL(String(input), "http://app.example").pathname);

const runEarlyFetchScript = (pathname: string) => {
  vi.stubGlobal("location", { origin: "http://app.example", pathname });
  new Function("window", "location", "fetch", earlyFetchScript)(
    globalThis,
    globalThis.location,
    fetchByPath,
  );
};

const remainingEarlyFetches = () => [
  ...(globalThis.taimeiEarlyFetches?.keys() ?? []),
];

const fetchSpy = vi.fn(fetchByPath);

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.taimeiEarlyFetches = undefined;
});

type LeafOptions = {
  loader?: unknown;
  errorComponent?: unknown;
  beforeLoad?: () => unknown;
};

const routerAt = (path: string) =>
  createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    origin: "http://app.example",
  });

const routeOptions = (path: string) =>
  Object.values(routerAt("/").routesByPath)
    .filter((route) => route.fullPath.startsWith(path))
    .map((route) => [route.fullPath, route.options as LeafOptions] as const);

const pathnameOf = (fullPath: string) => fullPath.replace("$teamId", TEAM_ID);

const loadEarlyFetched = async (pathname: string) => {
  runEarlyFetchScript(pathname);
  await routerAt(pathname).load();
};

describe("画面の葉", () => {
  it("/dashboard/ の下で loader を持つ葉は 3 つで、どれも errorComponent を持つ", () => {
    const leaves = routeOptions("/dashboard/").filter(
      ([, options]) => options.loader,
    );

    expect(leaves.map(([fullPath]) => fullPath).sort()).toEqual([
      "/dashboard/members",
      "/dashboard/teams",
      "/dashboard/teams/$teamId",
    ]);
    for (const [, options] of leaves)
      expect(options.errorComponent).toBeDefined();
  });
});

describe("web/index.html の先読みの script が始めた fetch を、その画面の loader がすべて使い、要求を足さない", () => {
  it.each([
    "/dashboard/teams",
    "/dashboard/teams/$teamId",
    "/dashboard/members",
  ])("%s", async (fullPath) => {
    await loadEarlyFetched(pathnameOf(fullPath));

    expect(remainingEarlyFetches()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("/dashboard は redirect 先の画面", async () => {
    const [[, index]] = routeOptions("/dashboard/").filter(
      ([fullPath]) => fullPath === "/dashboard/",
    );
    const redirected = (() => {
      try {
        index.beforeLoad?.();
      } catch (thrown) {
        if (isRedirect(thrown)) return thrown.options.to;
      }
    })();
    runEarlyFetchScript("/dashboard");

    await routerAt(String(redirected)).load();

    expect(redirected).toBe("/dashboard/teams");
    expect(remainingEarlyFetches()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
