// biome-ignore-start lint/style/noRestrictedImports: 画面の atom と hook を置く file
import {
  RegistryContext,
  useAtomSuspense,
  useAtomValue,
} from "@effect/atom-react";
// biome-ignore-end lint/style/noRestrictedImports: 画面の atom と hook を置く file
import {
  Cause,
  Data,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
// biome-ignore lint/style/noRestrictedImports: SPA の契約の client を作る file (ADR-0007)
import { FetchHttpClient, HttpClientError } from "effect/http";
// biome-ignore-start lint/style/noRestrictedImports: 画面の atom と hook を置く file
import {
  AsyncResult,
  Atom,
  AtomHttpApi,
  AtomRegistry,
} from "effect/reactivity";
// biome-ignore-end lint/style/noRestrictedImports: 画面の atom と hook を置く file
import { use, useState, useTransition } from "react";
import { NAME_MAX_LENGTH } from "../../db/column-values";
import {
  type OperationFailure,
  SESSION_HEADER,
  type SessionChanged,
  SpaApi,
  type TeamPage,
  type Unauthenticated,
} from "../../src/spa-contract";
import {
  type MyLevelEntry,
  type TeamDetail,
  withMyLevels,
} from "./dashboard/skill-matrix";

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

// atom を key にした WeakMap なので、印は atom を registry にも memory にも留めない
type StaleMark = { marked: number; refetchStarted: number; refetched: number };
const staleMarksByRegistry = new WeakMap<
  AtomRegistry.AtomRegistry,
  WeakMap<Atom.Atom<unknown>, StaleMark>
>();

const staleMarkOf = (
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<unknown>,
) => {
  const marks = staleMarksByRegistry.get(registry) ?? new WeakMap();
  staleMarksByRegistry.set(registry, marks);
  const mark = marks.get(atom) ?? {
    marked: 0,
    refetchStarted: 0,
    refetched: 0,
  };
  marks.set(atom, mark);
  return mark;
};

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

const definedInApiTs = Symbol("definedInApiTs");

type ChangedByMutation = Data.TaggedEnum<{
  TeamList: {};
  Team: { readonly teamId: string };
  TeamDeleted: { readonly teamId: string };
  MyLevels: {
    readonly teamId: string;
    readonly myUserId: string;
    readonly entries: readonly MyLevelEntry[];
  };
}>;
const ChangedByMutation = Data.taggedEnum<ChangedByMutation>();

export type MutationDefinition<V, A, E> = {
  readonly send: (client: SpaClient, variables: V) => Effect.Effect<A, E>;
  readonly changed: (variables: V) => ChangedByMutation;
};

export type ApiMutation<V, A, E> = MutationDefinition<V, A, E> & {
  readonly [definedInApiTs]: true;
};

type ClientDefect = HttpClientError.HttpClientError | Schema.SchemaError;

const isClientDefect = (error: unknown): error is ClientDefect =>
  HttpClientError.isHttpClientError(error) || Schema.isSchemaError(error);

// AtomHttpApi の query と同じく、契約に無い応答と decode の失敗は defect にする
const apiMutation = <A, E, V = void>(
  mutation: MutationDefinition<V, A, E | ClientDefect>,
): ApiMutation<V, A, E> => ({
  send: (client, variables) =>
    Effect.catchIf(
      mutation.send(client, variables),
      isClientDefect,
      Effect.die,
    ),
  changed: mutation.changed,
  [definedInApiTs]: true,
});

export const markStale = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) => {
  staleMarkOf(registry, atom).marked += 1;
};

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

const refreshAfter = (
  registry: AtomRegistry.AtomRegistry,
  changed: ChangedByMutation,
) =>
  Match.valueTags(changed, {
    TeamList: () => markTeamListStale(registry),
    Team: ({ teamId }) => refetchUpdatedTeam(registry, teamId),
    TeamDeleted: ({ teamId }) => {
      markTeamListStale(registry);
      markStale(registry, teamAtom(teamId));
    },
    MyLevels: ({ teamId, myUserId, entries }) =>
      writeSavedMyLevels(registry, teamId, myUserId, entries),
  });

export const createTeam = apiMutation({
  send: (client, name: string) => client.teams.create({ payload: { name } }),
  changed: () => ChangedByMutation.TeamList(),
});

const teamUpdate = <V, A, E>(
  teamId: string,
  send: MutationDefinition<V, A, E | ClientDefect>["send"],
) =>
  apiMutation<A, E, V>({
    send,
    changed: () => ChangedByMutation.Team({ teamId }),
  });

export const renameTeam = (teamId: string) =>
  teamUpdate(teamId, (client, name: string) =>
    client.teams.rename({ params: { teamId }, payload: { name } }),
  );

export const deleteTeam = (teamId: string) =>
  apiMutation({
    send: (client) => client.teams.delete({ params: { teamId } }),
    changed: () => ChangedByMutation.TeamDeleted({ teamId }),
  });

export const addSkill = (teamId: string) =>
  teamUpdate(teamId, (client, name: string) =>
    client.teams.addSkill({ params: { teamId }, payload: { name } }),
  );

export const removeSkill = (teamId: string) =>
  teamUpdate(teamId, (client, skillId: string) =>
    client.teams.removeSkill({ params: { skillId } }),
  );

export const assignMember = (teamId: string) =>
  teamUpdate(teamId, (client, userId: string) =>
    client.teams.assign({ params: { teamId, userId } }),
  );

export const unassignMember = (teamId: string) =>
  teamUpdate(teamId, (client, userId: string) =>
    client.teams.unassign({ params: { teamId, userId } }),
  );

export const saveMyLevels = (teamId: string, myUserId: string) =>
  apiMutation({
    send: (client, levels: readonly MyLevelEntry[]) =>
      client.teams.saveMyLevels({ params: { teamId }, payload: { levels } }),
    changed: (entries) =>
      ChangedByMutation.MyLevels({ teamId, myUserId, entries }),
  });

// AtomHttpApi.mutation の atom は endpoint ごとに 1 つで、同じ atom への次の呼び出しが前の呼び出しを中断するので、呼び出しごとに作る
const mutationAtom = <A, E>() =>
  SpaApiClient.runtime.fn(
    (request: { readonly send: (client: SpaClient) => Effect.Effect<A, E> }) =>
      SpaApiClient.use(request.send),
  );

export const runApiMutation = async <V, A, E>(
  registry: AtomRegistry.AtomRegistry,
  mutation: ApiMutation<V, A, E>,
  variables: V,
): Promise<Exit.Exit<A, E>> => {
  const atom = mutationAtom<A, E>();
  const unmount = registry.mount(atom);
  try {
    registry.set(atom, {
      send: (client) => mutation.send(client, variables),
    });
    const exit = await Effect.runPromiseExit(nonWaitingResult(registry, atom));
    if (Exit.isSuccess(exit))
      await refreshAfter(registry, mutation.changed(variables));
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
  const mark = staleMarkOf(registry, atom);
  const latestMark = mark.marked;
  const cached = registry.get(atom);
  const cachedValue = AsyncResult.value(cached);
  if (mark.refetched === latestMark && Option.isSome(cachedValue)) {
    if (!cached.waiting) {
      registry.refresh(atom);
      // 購読の無い atom の refresh は次の読み取りまで取り直さない
      registry.get(atom);
    }
    return cachedValue.value;
  }
  const fetchInFlightMayPredateMark = mark.refetchStarted < latestMark;
  if (fetchInFlightMayPredateMark || !cached.waiting) {
    registry.refresh(atom);
    mark.refetchStarted = latestMark;
  }
  const fresh = await waitForValue(registry, atom);
  mark.refetched = Math.max(mark.refetched, latestMark);
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

export const failureOf = <A, E>(
  exit: Exit.Exit<A, E>,
): Cause.Cause<E> | undefined =>
  Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
    ? undefined
    : exit.cause;

export const loadFailureOf = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): Cause.Cause<E> | undefined =>
  AsyncResult.isFailure(result) ? result.cause : undefined;

export const useLoadFailure = <A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) => loadFailureOf(useAtomValue(atom));

export const runApiMutationForScreen = async <V, A, E>(
  registry: AtomRegistry.AtomRegistry,
  mutation: ApiMutation<V, A, E>,
  variables: V,
  handlers: {
    readonly showFailure: (failure: Cause.Cause<E> | undefined) => void;
    readonly onSuccess?: (value: A) => unknown;
    readonly afterOnSuccess?: () => void;
  },
) => {
  const exit = await runApiMutation(registry, mutation, variables);
  handlers.showFailure(failureOf(exit));
  if (Exit.isFailure(exit)) return;
  await handlers.onSuccess?.(exit.value);
  handlers.afterOnSuccess?.();
};

export const useApiMutation = <V, A, E>(
  mutation: ApiMutation<V, A, E>,
  options: { onSuccess?: (value: A) => unknown } = {},
) => {
  const registry = use(RegistryContext);
  const [isPending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Cause.Cause<E>>();
  const [variables, setVariables] = useState<V>();
  const mutate = (
    variables: V,
    callOptions: { onSuccess?: () => void } = {},
  ) => {
    if (isPending) return;
    setFailure(undefined);
    setVariables(variables);
    startTransition(() =>
      runApiMutationForScreen(registry, mutation, variables, {
        showFailure: setFailure,
        onSuccess: options.onSuccess,
        afterOnSuccess: callOptions.onSuccess,
      }),
    );
  };
  return {
    mutate,
    isPending,
    failure,
    pendingVariables: isPending ? variables : undefined,
  };
};

export const useSaveMyLevels = (
  teamId: string,
  myUserId: string,
  savedTeam: TeamDetail,
) => {
  const save = useApiMutation(saveMyLevels(teamId, myUserId));
  return {
    teamWithPendingSave: save.pendingVariables
      ? withMyLevels(savedTeam, myUserId, save.pendingVariables)
      : savedTeam,
    saving: save.isPending,
    failure: save.failure,
    onSave: save.mutate,
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

export type ShownFailure = Cause.Cause<
  OperationFailure | Unauthenticated | SessionChanged
>;

export const failureMessageOf = (
  failure: ShownFailure | undefined,
  fallbackMessage: string,
) =>
  failure === undefined
    ? fallbackMessage
    : Option.match(Cause.findErrorOption(failure), {
        onNone: () => fallbackMessage,
        onSome: (error) =>
          error._tag === "Unauthenticated" || error._tag === "SessionChanged"
            ? fallbackMessage
            : failureMessages[error._tag],
      });
