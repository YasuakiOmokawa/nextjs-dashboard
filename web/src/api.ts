import { RegistryContext, useAtomSuspense } from "@effect/atom-react";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
// biome-ignore lint/style/noRestrictedImports: SPA の契約の client を作る file (ADR-0007)
import { FetchHttpClient } from "effect/http";
import {
  AsyncResult,
  Atom,
  AtomHttpApi,
  AtomRegistry,
} from "effect/reactivity";
import { use, useState, useTransition } from "react";
import { NAME_MAX_LENGTH } from "../../db/column-values";
import {
  OperationFailure,
  SESSION_HEADER,
  SpaApi,
  type TeamPage,
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

class SpaApiClient extends AtomHttpApi.Service<SpaApiClient>()("SpaApiClient", {
  api: SpaApi,
  httpClient: Layer.provide(
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, fetchWithinSession),
  ),
}) {}

const UNUSED_CACHE_RETENTION = "5 minutes";

export const meAtom = SpaApiClient.query("me", "get", {
  timeToLive: UNUSED_CACHE_RETENTION,
});

export const teamsAtom = SpaApiClient.query("teams", "list", {
  timeToLive: UNUSED_CACHE_RETENTION,
});

export const membersAtom = SpaApiClient.query("members", "list", {
  timeToLive: UNUSED_CACHE_RETENTION,
});

const keepShownUntilFreshSuccess = <A, E>(
  fetchedResult: AsyncResult.AsyncResult<A, E>,
  shownResult: Option.Option<AsyncResult.AsyncResult<A, E>>,
): AsyncResult.AsyncResult<A, E> => {
  const shown = Option.flatMap(shownResult, (result) =>
    AsyncResult.isFailure(result)
      ? result.previousSuccess
      : Option.liftPredicate(result, AsyncResult.isSuccess),
  );
  if (Option.isNone(shown)) return fetchedResult;
  if (fetchedResult.waiting) return AsyncResult.waiting(shown.value);
  return AsyncResult.isFailure(fetchedResult)
    ? AsyncResult.failure(fetchedResult.cause, { previousSuccess: shown })
    : fetchedResult;
};

export const teamAtom = Atom.family((teamId: string) => {
  const fetched = SpaApiClient.query("teams", "get", { params: { teamId } });
  return Atom.writable(
    (get) => {
      const fetchedResult = get(fetched);
      return keepShownUntilFreshSuccess(
        fetchedResult,
        get.self<typeof fetchedResult>(),
      );
    },
    (ctx, page: TeamPage) => ctx.setSelf(AsyncResult.success(page)),
    (refresh) => refresh(fetched),
  ).pipe(Atom.setIdleTTL(UNUSED_CACHE_RETENTION));
});

const staleMark = Atom.family((_atom: Atom.Atom<unknown>) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

const nonWaitingResult = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) => AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });

export const waitForValue = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> => Effect.runPromise(nonWaitingResult(registry, atom));

export const waitForRefetch = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<void> =>
  Effect.runPromise(
    Effect.asVoid(Effect.exit(nonWaitingResult(registry, atom))),
  );

type SpaClient = SpaApiClient["Service"];

export type ApiMutation<V, A, E> = {
  readonly send: (client: SpaClient, variables: V) => Effect.Effect<A, E>;
  readonly afterSuccess?: (
    registry: AtomRegistry.AtomRegistry,
    variables: V,
    value: A,
  ) => unknown;
};

const apiMutation = <A, E, V = void>(
  mutation: ApiMutation<V, A, E>,
): ApiMutation<V, A, E> => mutation;

export const markStale = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) => registry.set(staleMark(atom), true);

const markTeamListStale = (registry: AtomRegistry.AtomRegistry) =>
  markStale(registry, teamsAtom);

const refetchUpdatedTeam = (
  registry: AtomRegistry.AtomRegistry,
  teamId: string,
) => {
  markTeamListStale(registry);
  registry.refresh(teamAtom(teamId));
  return waitForRefetch(registry, teamAtom(teamId));
};

export const createTeam = apiMutation({
  send: (client, name: string) => client.teams.create({ payload: { name } }),
  afterSuccess: markTeamListStale,
});

export const renameTeam = (teamId: string) =>
  apiMutation({
    send: (client, name: string) =>
      client.teams.rename({ params: { teamId }, payload: { name } }),
    afterSuccess: (registry) => refetchUpdatedTeam(registry, teamId),
  });

export const deleteTeam = (teamId: string) =>
  apiMutation({
    send: (client) => client.teams.delete({ params: { teamId } }),
    afterSuccess: markTeamListStale,
  });

export const addSkill = (teamId: string) =>
  apiMutation({
    send: (client, name: string) =>
      client.teams.addSkill({ params: { teamId }, payload: { name } }),
    afterSuccess: (registry) => refetchUpdatedTeam(registry, teamId),
  });

export const removeSkill = (teamId: string) =>
  apiMutation({
    send: (client, skillId: string) =>
      client.teams.removeSkill({ params: { skillId } }),
    afterSuccess: (registry) => refetchUpdatedTeam(registry, teamId),
  });

export const assignMember = (teamId: string) =>
  apiMutation({
    send: (client, userId: string) =>
      client.teams.assign({ params: { teamId, userId } }),
    afterSuccess: (registry) => refetchUpdatedTeam(registry, teamId),
  });

export const unassignMember = (teamId: string) =>
  apiMutation({
    send: (client, userId: string) =>
      client.teams.unassign({ params: { teamId, userId } }),
    afterSuccess: (registry) => refetchUpdatedTeam(registry, teamId),
  });

export const saveMyLevels = (teamId: string, myUserId: string) =>
  apiMutation({
    send: (client, levels: readonly MyLevelEntry[]) =>
      client.teams.saveMyLevels({ params: { teamId }, payload: { levels } }),
    afterSuccess: (registry, levels) =>
      writeSavedMyLevels(registry, teamId, myUserId, levels),
  });

// AtomHttpApi.mutation の atom は endpoint ごとに 1 つで、同じ atom への次の呼び出しが前の呼び出しを中断するので、呼び手ごとに作る
export const mutationAtom = <A, E>() =>
  SpaApiClient.runtime.fn(
    (request: { readonly send: (client: SpaClient) => Effect.Effect<A, E> }) =>
      SpaApiClient.use(request.send),
  );

export const runApiMutation = async <V, A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: ReturnType<typeof mutationAtom<A, E>>,
  mutation: ApiMutation<V, A, E>,
  variables: V,
): Promise<Exit.Exit<A, E>> => {
  const unmount = registry.mount(atom);
  try {
    registry.set(atom, {
      send: (client) => mutation.send(client, variables),
    });
    const exit = await Effect.runPromiseExit(nonWaitingResult(registry, atom));
    if (Exit.isSuccess(exit))
      await mutation.afterSuccess?.(registry, variables, exit.value);
    return exit;
  } finally {
    unmount();
  }
};

export const writeSavedMyLevels = (
  registry: AtomRegistry.AtomRegistry,
  teamId: string,
  myUserId: string,
  entries: readonly MyLevelEntry[],
) => {
  const atom = teamAtom(teamId);
  const shown = registry.get(atom);
  const page = AsyncResult.value(shown);
  if (Option.isNone(page)) return;
  registry.set(atom, {
    ...page.value,
    team: withMyLevels(page.value.team, myUserId, entries),
  });
  const fetchStartedBeforeSave = shown.waiting;
  if (fetchStartedBeforeSave) registry.refresh(atom);
};

export const loadAtom = async <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> => {
  const invalidated = registry.get(staleMark(atom));
  const cached = registry.get(atom);
  const cachedValue = AsyncResult.value(cached);
  if (!invalidated && Option.isSome(cachedValue)) {
    if (!cached.waiting) {
      registry.refresh(atom);
      // 購読の無い atom の refresh は次の読み取りまで取り直さない
      registry.get(atom);
    }
    return cachedValue.value;
  }
  if (!cached.waiting) registry.refresh(atom);
  const fresh = await waitForValue(registry, atom);
  registry.set(staleMark(atom), false);
  return fresh;
};

export const loadedValueOf = <A, E>(
  result: AsyncResult.Success<A, E> | AsyncResult.Failure<A, E>,
): A =>
  AsyncResult.isSuccess(result)
    ? result.value
    : Option.getOrThrowWith(AsyncResult.value(result), () =>
        Cause.squash(result.cause),
      );

export const useLoadedValue = <A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) => loadedValueOf(useAtomSuspense(atom, { includeFailure: true }));

export const failureToShow = <A, E>(exit: Exit.Exit<A, E>): unknown =>
  Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
    ? undefined
    : Cause.squash(exit.cause);

export const useApiMutation = <V, A, E>(
  mutation: ApiMutation<V, A, E>,
  options: { onSuccess?: (value: A) => unknown } = {},
) => {
  const registry = use(RegistryContext);
  const [atom] = useState(mutationAtom<A, E>);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<unknown>();
  const [variables, setVariables] = useState<V>();
  const mutate = (
    variables: V,
    callOptions: { onSuccess?: () => void } = {},
  ) => {
    if (isPending) return;
    setError(undefined);
    setVariables(variables);
    startTransition(async () => {
      const exit = await runApiMutation(registry, atom, mutation, variables);
      setError(failureToShow(exit));
      if (Exit.isFailure(exit)) return;
      await options.onSuccess?.(exit.value);
      callOptions.onSuccess?.();
    });
  };
  return {
    mutate,
    isPending,
    error,
    pendingVariables: isPending ? variables : undefined,
  };
};

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
