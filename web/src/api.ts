import {
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import {
  DetailedError,
  hc,
  type InferRequestType,
  type InferResponseType,
  parseResponse,
} from "hono/client";
import type { AppType, SessionHeader } from "../../src/app";
import { type MyLevelEntry, withMyLevels } from "./dashboard/skill-matrix";

declare global {
  // web/index.html が JS の読み込みを待たずに始めた画面の API の fetch
  var taimeiEarlyFetches: Map<string, Promise<Response>> | undefined;
}

const takeEarlyFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input !== "string" || (init?.method ?? "GET") !== "GET")
    return undefined;
  const early = globalThis.taimeiEarlyFetches?.get(input);
  globalThis.taimeiEarlyFetches?.delete(input);
  return early;
};

const SESSION_HEADER: SessionHeader = "x-taimei-session";
let markOfThisPage: string | undefined;

const differsFromFirstMarkOfPage = (response: Response) => {
  const mark = response.headers.get(SESSION_HEADER);
  if (mark === null) return false;
  markOfThisPage ??= mark;
  return mark !== markOfThisPage;
};

const untilPageUnloads = () => new Promise<never>(() => {});

const withSessionMark = (init: RequestInit | undefined) => {
  if (markOfThisPage === undefined) return init;
  const headers = new Headers(init?.headers);
  headers.set(SESSION_HEADER, markOfThisPage);
  return { ...init, headers };
};

// session の middleware が返す 401 は hc の型に入らないので、全ての API の呼び出しをここで受けてログインへ移す
const fetchWithinSession: typeof fetch = async (input, init) => {
  const response = await (takeEarlyFetch(input, init) ??
    fetch(input, withSessionMark(init)));
  if (response.status === 401) {
    const callbackUrl = encodeURIComponent(location.pathname + location.search);
    location.assign(`/auth?callbackUrl=${callbackUrl}`);
    return untilPageUnloads();
  }
  if (differsFromFirstMarkOfPage(response)) {
    location.reload();
    return untilPageUnloads();
  }
  return response;
};

const { api } = hc<AppType>("/", { fetch: fetchWithinSession });

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => parseResponse(api.me.$get()),
});

export const teamsQuery = queryOptions({
  queryKey: ["teams"],
  queryFn: () => parseResponse(api.teams.$get()),
});

export const membersQuery = queryOptions({
  queryKey: ["members"],
  queryFn: () => parseResponse(api.members.$get()),
});

export const loadQuery = <TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TQueryKey>,
) => {
  const state = queryClient.getQueryState<TData>(options.queryKey);
  const cachedAndValid = state?.isInvalidated ? undefined : state?.data;
  const fetched = queryClient.query(options);
  if (cachedAndValid === undefined) return fetched;
  fetched.catch(() => {});
  return Promise.resolve(cachedAndValid);
};

// cache を先に出す読み取りに作成・削除の前の一覧を出させない。表示中の一覧は画面の移動で外れるので取り直さない
export const markTeamListStaleWithoutRefetch = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    queryKey: teamsQuery.queryKey,
    refetchType: "none",
  });

export const createTeam = (name: string) =>
  parseResponse(api.teams.$post({ json: { name } }));

// hc は path の param を escape しないので、param は全て encodeURIComponent して渡す
const teamApi = api.teams[":teamId"];

export type TeamPage = InferResponseType<typeof teamApi.$get, 200>;

export const teamQuery = (teamId: string) =>
  queryOptions({
    queryKey: ["team", teamId],
    queryFn: () =>
      parseResponse(
        teamApi.$get({ param: { teamId: encodeURIComponent(teamId) } }),
      ),
  });

export const renameTeam = (teamId: string, name: string) =>
  parseResponse(
    teamApi.$patch({
      param: { teamId: encodeURIComponent(teamId) },
      json: { name },
    }),
  );

export const deleteTeam = (teamId: string) =>
  parseResponse(
    teamApi.$delete({ param: { teamId: encodeURIComponent(teamId) } }),
  );

const myLevelsApi = teamApi["my-levels"];

export const saveMyLevels = (
  teamId: string,
  levels: InferRequestType<typeof myLevelsApi.$put>["json"]["levels"],
) =>
  parseResponse(
    myLevelsApi.$put({
      param: { teamId: encodeURIComponent(teamId) },
      json: { levels },
    }),
  );

export const addSkill = (teamId: string, name: string) =>
  parseResponse(
    teamApi.skills.$post({
      param: { teamId: encodeURIComponent(teamId) },
      json: { name },
    }),
  );

export const removeSkill = (skillId: string) =>
  parseResponse(
    api.skills[":skillId"].$delete({
      param: { skillId: encodeURIComponent(skillId) },
    }),
  );

const assignmentApi = teamApi.assignments[":userId"];

export const assignMember = (teamId: string, userId: string) =>
  parseResponse(
    assignmentApi.$put({
      param: {
        teamId: encodeURIComponent(teamId),
        userId: encodeURIComponent(userId),
      },
    }),
  );

export const unassignMember = (teamId: string, userId: string) =>
  parseResponse(
    assignmentApi.$delete({
      param: {
        teamId: encodeURIComponent(teamId),
        userId: encodeURIComponent(userId),
      },
    }),
  );

export const failureMessageOf = (error: unknown, fallbackMessage: string) => {
  const message =
    error instanceof DetailedError ? error.detail?.data?.message : undefined;
  return typeof message === "string" ? message : fallbackMessage;
};

export const writeSavedMyLevels = async (
  queryClient: QueryClient,
  teamId: string,
  myUserId: string,
  entries: readonly MyLevelEntry[],
) => {
  const { queryKey } = teamQuery(teamId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(
    queryKey,
    (page) =>
      page && { ...page, team: withMyLevels(page.team, myUserId, entries) },
  );
};
