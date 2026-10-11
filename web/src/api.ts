import { queryOptions } from "@tanstack/react-query";
import { hc, type InferResponseType, parseResponse } from "hono/client";
import type { AppType } from "../../src/app";

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

export type TeamPage = InferResponseType<typeof teamApi.$get, 200>;

export const teamQuery = (teamId: string) =>
  queryOptions({
    queryKey: ["team", teamId],
    queryFn: () =>
      parseResponse(
        teamApi.$get({ param: { teamId: encodeURIComponent(teamId) } }),
      ),
  });
