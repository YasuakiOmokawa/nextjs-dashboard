import { QueryClient } from "@tanstack/react-query";
import { DetailedError } from "hono/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  failureMessageOf,
  saveMyLevels,
  type TeamPage,
  teamQuery,
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

it("保存は teamId を escape して path に入れる", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  vi.stubGlobal("fetch", fetch);

  await saveMyLevels("../members", []);

  expect(String(fetch.mock.calls[0]?.[0])).toBe(
    "/api/teams/..%2Fmembers/my-levels",
  );
});

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
])("%s の文言は「保存できませんでした」", (_, error) => {
  expect(failureMessageOf(error)).toBe("保存できませんでした");
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
    .fetchQuery({ queryKey, queryFn: () => staleFetch.promise })
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
