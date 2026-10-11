import { Effect, Layer, ManagedRuntime, Result } from "effect";
import { db } from "@/db/drizzle/client";
import { withCompanyScope } from "@/db/scoped";
import { reportUnexpectedFailure } from "@/src/lib/team-failure";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { CompanyMembers } from "./company-members-service";
import { Db, DbUnavailable, ReadDb } from "./db-service";
import { NotManager, type TeamFailure } from "./team-errors";
import { TeamReads } from "./team-reads";
import { TeamManagement, TeamService } from "./team-service";

export type RequestSession = CompanyContext["Service"] &
  AuthorizationContext["Service"] & {
    readonly userName: string;
    readonly companyMembers: CompanyMembers["Service"];
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
  | CompanyMembers;

// 要求ごとの Service を Live に含めると session 無しで実行できてしまう (docs/adr/0002 D3)
type _NoRequestContextInLive = [
  Extract<LiveServices, ProvidedPerRequest | Db>,
] extends [never]
  ? true
  : "ERROR: per-request services must NOT be in Live";
const _assertNoRequestContextInLive: _NoRequestContextInLive = true;

declare const fromExecutor: unique symbol;
// resultJson が実行口を通さずに作った Result を受けないための印
export type ServiceResult<A, E> = Result.Result<A, E> & {
  readonly [fromExecutor]: true;
};

const reported = <A, E extends TeamFailure>(result: Result.Result<A, E>) => {
  if (Result.isFailure(result)) reportUnexpectedFailure(result.failure);
  return result as ServiceResult<A, E>;
};

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
    );

// SQL を流さない本体に、transaction の接続と BEGIN・set_config・COMMIT を払わせない
export const runServiceWithoutDb = async <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<A, E, LiveServices | ProvidedPerRequest>,
): Promise<ServiceResult<A, E>> =>
  reported(
    await runtime.runPromise(
      Effect.result(Effect.suspend(body).pipe(provideSession(session))),
    ),
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
): Promise<ServiceResult<A, E | DbUnavailable>> => {
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
  return reported(result);
};

export const runScopedService = <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<
    A,
    E,
    LiveServices | Layer.Success<typeof RequestScoped> | ProvidedPerRequest | Db
  >,
) =>
  runInCompanyScope(session, () => body().pipe(Effect.provide(RequestScoped)));

export const runManagerScopedService = async <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<
    A,
    E,
    LiveServices | Layer.Success<typeof ManagerScoped> | ProvidedPerRequest | Db
  >,
): Promise<ServiceResult<A, E | NotManager | DbUnavailable>> =>
  isManager(session.role)
    ? runInCompanyScope(session, () =>
        body().pipe(Effect.provide(ManagerScoped)),
      )
    : reported(Result.fail(new NotManager()));
