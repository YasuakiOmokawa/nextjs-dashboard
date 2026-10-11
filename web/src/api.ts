import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  DetailedError,
  hc,
  type InferRequestType,
  type InferResponseType,
  parseResponse,
} from "hono/client";
import type { AppType } from "../../src/app";
import { type MyLevelEntry, withMyLevels } from "./dashboard/skill-matrix";

// session の middleware が返す 401 は hc の型に入らないので、全ての API の呼び出しをここで受けてログインへ移す
const fetchRedirectingToLogin: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;
  const callbackUrl = encodeURIComponent(location.pathname + location.search);
  location.assign(`/auth?callbackUrl=${callbackUrl}`);
  return new Promise<never>(() => {});
};

const { api } = hc<AppType>("/", { fetch: fetchRedirectingToLogin });

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

const teamApi = api.teams[":teamId"];

// hc は path の param を escape しない
const escapedTeamParam = (teamId: string) => ({
  teamId: encodeURIComponent(teamId),
});

export type TeamPage = InferResponseType<typeof teamApi.$get, 200>;

export const teamQuery = (teamId: string) =>
  queryOptions({
    queryKey: ["team", teamId],
    queryFn: () =>
      parseResponse(teamApi.$get({ param: escapedTeamParam(teamId) })),
  });

const myLevelsApi = teamApi["my-levels"];

export const saveMyLevels = (
  teamId: string,
  levels: InferRequestType<typeof myLevelsApi.$put>["json"]["levels"],
) =>
  parseResponse(
    myLevelsApi.$put({
      param: escapedTeamParam(teamId),
      json: { levels },
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
