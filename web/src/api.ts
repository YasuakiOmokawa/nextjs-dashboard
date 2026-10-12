import {
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import { Effect, Schema } from "effect";
// biome-ignore lint/style/noRestrictedImports: SPA の契約の client を作る file (ADR-0007)
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { NAME_MAX_LENGTH } from "../../db/column-values";
import {
  type LevelEntry,
  OperationFailure,
  SESSION_HEADER,
  SpaApi,
} from "../../src/spa-contract";
import { type MyLevelEntry, withMyLevels } from "./dashboard/skill-matrix";

declare global {
  // web/index.html が JS の読み込みを待たずに始めた画面の API の fetch
  var taimeiEarlyFetches: Map<string, Promise<Response>> | undefined;
}

const pathOf = (input: RequestInfo | URL) => {
  const url = new URL(
    input instanceof Request ? input.url : input,
    location.origin,
  );
  return url.pathname + url.search;
};

const takeEarlyFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const earlyFetches = globalThis.taimeiEarlyFetches;
  if (!earlyFetches?.size || (init?.method ?? "GET") !== "GET")
    return undefined;
  const path = pathOf(input);
  const early = earlyFetches.get(path);
  earlyFetches.delete(path);
  return early;
};

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

const spaClient = HttpApiClient.make(SpaApi).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.provideService(FetchHttpClient.Fetch, fetchWithinSession),
);

const cachedSpaClient = Effect.runSync(Effect.cached(spaClient));

const callApi = <A, E>(
  call: (client: Effect.Success<typeof spaClient>) => Effect.Effect<A, E>,
) => Effect.runPromise(Effect.flatMap(cachedSpaClient, call));

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => callApi((client) => client.me.get()),
});

export const teamsQuery = queryOptions({
  queryKey: ["teams"],
  queryFn: () => callApi((client) => client.teams.list()),
});

export const membersQuery = queryOptions({
  queryKey: ["members"],
  queryFn: () => callApi((client) => client.members.list()),
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
  callApi((client) => client.teams.create({ payload: { name } }));

export const teamQuery = (teamId: string) =>
  queryOptions({
    queryKey: ["team", teamId],
    queryFn: () =>
      callApi((client) => client.teams.get({ params: { teamId } })),
  });

export const renameTeam = (teamId: string, name: string) =>
  callApi((client) =>
    client.teams.rename({ params: { teamId }, payload: { name } }),
  );

export const deleteTeam = (teamId: string) =>
  callApi((client) => client.teams.delete({ params: { teamId } }));

export const saveMyLevels = (teamId: string, levels: readonly LevelEntry[]) =>
  callApi((client) =>
    client.teams.saveMyLevels({ params: { teamId }, payload: { levels } }),
  );

export const addSkill = (teamId: string, name: string) =>
  callApi((client) =>
    client.teams.addSkill({ params: { teamId }, payload: { name } }),
  );

export const removeSkill = (skillId: string) =>
  callApi((client) => client.teams.removeSkill({ params: { skillId } }));

export const assignMember = (teamId: string, userId: string) =>
  callApi((client) => client.teams.assign({ params: { teamId, userId } }));

export const unassignMember = (teamId: string, userId: string) =>
  callApi((client) => client.teams.unassign({ params: { teamId, userId } }));

const failureMessages = {
  NotManager: "管理者だけが操作できます",
  TeamNotFound: "チームが見つかりません",
  SkillNotFound: "スキルが見つかりません",
  NotCompanyMember: "事業所のメンバーではありません",
  InvalidName: `名前は 1〜${NAME_MAX_LENGTH} 文字で入力してください`,
  DuplicateName: "同じ名前がすでにあります",
  NotAssigned: "チームに割り当てられた人だけが記入できます",
  InvalidLevel: "レベルの値が正しくありません",
} satisfies { readonly [Tag in OperationFailure["_tag"]]: string };

const isOperationFailure = Schema.is(OperationFailure);

export const failureMessageOf = (error: unknown, fallbackMessage: string) =>
  isOperationFailure(error) ? failureMessages[error._tag] : fallbackMessage;

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
