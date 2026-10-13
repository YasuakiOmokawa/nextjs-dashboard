import { Effect, Layer, ManagedRuntime, Result } from "effect";
import { db } from "@/db/drizzle/client";
import type { CompanyId } from "@/db/ids";
import { withCompanyScope } from "@/db/scoped";
import { NotManager } from "@/src/spa-contract";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { CompanyMembers } from "./company-members-service";
import {
  bumpTeamListInWriteTransaction,
  CompanyTeamList,
  rewriteTeamList,
} from "./company-team-list";
import { Db, DbUnavailable, ReadDb } from "./db-service";
import { type TeamFailure, TeamServiceError } from "./team-errors";
import { TeamReads } from "./team-reads";
import { TeamManagement, TeamService } from "./team-service";

export type RequestSession = CompanyContext["Service"] &
  AuthorizationContext["Service"] & {
    readonly userName: string;
    readonly companyMembers: CompanyMembers["Service"];
    readonly companyTeamListOf: (
      companyId: CompanyId,
    ) => CompanyTeamList["Service"];
  };

const Live = Layer.empty;
type LiveServices = Layer.Success<typeof Live>;

// Db を要る Service。実行口が request ごとに、RLS の事業所を設定した transaction の Db で作る (docs/adr/0005)
const RequestScoped = TeamService.layer;
// 組み立てが管理者でないと NotManager で失敗するので、メンバーも通る RequestScoped に混ぜない
const ManagerScoped = TeamManagement.layer;

const runtime = ManagedRuntime.make(Live);

type ProvidedPerRequest =
  | CompanyContext
  | AuthorizationContext
  | CompanyMembers
  | CompanyTeamList;

// 要求ごとの Service を Live に含めると session 無しで実行できてしまう (docs/adr/0002 D3)
type _NoRequestContextInLive = [
  Extract<LiveServices, ProvidedPerRequest | Db>,
] extends [never]
  ? true
  : "ERROR: per-request services must NOT be in Live";
const _assertNoRequestContextInLive: _NoRequestContextInLive = true;

const provideSession =
  (session: RequestSession) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(CompanyContext, { companyId: session.companyId }),
      Effect.provideService(AuthorizationContext, {
        userId: session.userId,
        role: session.role,
      }),
      Effect.provideService(CompanyMembers, session.companyMembers),
      Effect.provideService(
        CompanyTeamList,
        session.companyTeamListOf(session.companyId),
      ),
    );

// SQL を流さない本体に、transaction の接続と BEGIN・set_config・COMMIT を払わせない
export const runServiceWithoutDb = async <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<A, E, LiveServices | ProvidedPerRequest>,
): Promise<Result.Result<A, E>> =>
  runtime.runPromise(
    Effect.result(Effect.suspend(body).pipe(provideSession(session))),
  );

const ReadScoped = TeamReads.layer.pipe(
  Layer.provide(Layer.succeed(ReadDb, db)),
);

export const runReadService = <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<
    A,
    E,
    LiveServices | Layer.Success<typeof ReadScoped> | ProvidedPerRequest
  >,
) =>
  runServiceWithoutDb(session, () =>
    Effect.suspend(body).pipe(Effect.provide(ReadScoped)),
  );

class BodyDefect {
  constructor(readonly defect: unknown) {}
}

// drizzle は callback が throw した時にしか rollback しない
class BodyFailure<E> {
  constructor(readonly failure: E) {}
}

// companyId を引数で受けず session から導く理由は docs/adr/0002-company-data-scoping.md (D3)
const runInCompanyScope = async <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<A, E, LiveServices | ProvidedPerRequest | Db>,
): Promise<Result.Result<A, E | DbUnavailable>> => {
  let result: Result.Result<A, E | DbUnavailable>;
  try {
    result = await withCompanyScope(db, session.companyId, async (tx) => {
      const bodyResult = await runtime
        .runPromise(
          Effect.result(
            Effect.suspend(body).pipe(
              Effect.provideService(Db, tx),
              provideSession(session),
            ),
          ),
        )
        .catch((defect: unknown) => {
          throw new BodyDefect(defect);
        });
      if (Result.isFailure(bodyResult))
        throw new BodyFailure(bodyResult.failure);
      return bodyResult;
    });
  } catch (error) {
    if (error instanceof BodyDefect) throw error.defect;
    result =
      error instanceof BodyFailure
        ? Result.fail(error.failure)
        : Result.fail(new DbUnavailable({ cause: error }));
  }
  return result;
};

export const runScopedService = async <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<
    A,
    E,
    LiveServices | Layer.Success<typeof RequestScoped> | ProvidedPerRequest | Db
  >,
): Promise<Result.Result<A, E | DbUnavailable>> =>
  runInCompanyScope(session, () => body().pipe(Effect.provide(RequestScoped)));

export const rewriteTeamListAfterCommit = (
  teamList: CompanyTeamList["Service"],
  bumped: unknown,
) => runtime.runPromise(rewriteTeamList(teamList, bumped));

const bumpTeamListInScope = Effect.gen(function* () {
  const { companyId } = yield* CompanyContext;
  const scoped = yield* Db;
  return yield* Effect.tryPromise({
    try: () => bumpTeamListInWriteTransaction(scoped, companyId),
    catch: (cause) => new TeamServiceError({ cause }),
  });
});

// 一覧を変える書き込みは TeamManagement だけにある (docs/adr/0008)
export const runManagerScopedService = async <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<
    A,
    E,
    LiveServices | Layer.Success<typeof ManagerScoped> | ProvidedPerRequest | Db
  >,
): Promise<
  Result.Result<A, E | NotManager | TeamServiceError | DbUnavailable>
> => {
  if (!isManager(session.role)) return Result.fail(new NotManager());
  const result = await runInCompanyScope(session, () =>
    body().pipe(
      Effect.provide(ManagerScoped),
      Effect.flatMap((value) =>
        bumpTeamListInScope.pipe(Effect.map((bumped) => ({ value, bumped }))),
      ),
    ),
  );
  const teamList = session.companyTeamListOf(session.companyId);
  if (Result.isSuccess(result))
    await rewriteTeamListAfterCommit(teamList, result.success.bumped);
  else if (result.failure._tag === "DbUnavailable")
    await runtime.runPromise(teamList.clear);
  return Result.map(result, ({ value }) => value);
};
