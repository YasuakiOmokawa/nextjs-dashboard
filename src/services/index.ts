import { Effect, Layer, Result } from "effect";
import { db } from "@/db/drizzle/client";
import { NotManager } from "@/src/spa-contract";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { CompanyMembers } from "./company-members-service";
import { writeInCompanyScope } from "./company-scope";
import { CompanyTeamList, writeTeamList } from "./company-team-list";
import { Db, ReadDb } from "./db-service";
import type { DbFailure, TeamFailure } from "./failures";
import type { RequestSession } from "./request-session";
import { TeamManagement } from "./team-management";
import { TeamReads } from "./team-reads";
import { TeamService } from "./team-service";

type ProvidedPerRequest =
  | CompanyContext
  | AuthorizationContext
  | CompanyMembers;

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
export const runServiceWithoutDb = <A, E extends TeamFailure>(
  session: RequestSession,
  body: () => Effect.Effect<A, E, ProvidedPerRequest>,
): Promise<Result.Result<A, E>> =>
  Effect.runPromise(
    Effect.result(Effect.suspend(body).pipe(provideSession(session))),
  );

export const runTeamReads = <A, E extends TeamFailure>(
  session: RequestSession,
  use: (reads: TeamReads["Service"]) => Effect.Effect<A, E, ProvidedPerRequest>,
) =>
  runServiceWithoutDb(session, () =>
    TeamReads.use(use).pipe(
      Effect.provide(
        TeamReads.layer.pipe(
          Layer.provide([
            Layer.succeed(ReadDb, db),
            Layer.succeed(
              CompanyTeamList,
              session.companyTeamListOf(session.companyId),
            ),
          ]),
        ),
      ),
    ),
  );

const runInTransaction =
  <A, E>(
    session: RequestSession,
    body: Effect.Effect<A, E, ProvidedPerRequest | Db>,
  ) =>
  (tx: Db["Service"]) =>
    Effect.runPromise(
      Effect.result(
        body.pipe(Effect.provideService(Db, tx), provideSession(session)),
      ),
    );

export const runTeamService = <A, E extends TeamFailure>(
  session: RequestSession,
  use: (
    teams: TeamService["Service"],
  ) => Effect.Effect<A, E, ProvidedPerRequest | Db>,
): Promise<Result.Result<A, E | DbFailure>> =>
  writeInCompanyScope(
    db,
    session.companyId,
    runInTransaction(
      session,
      TeamService.use(use).pipe(Effect.provide(TeamService.layer)),
    ),
  );

export const runTeamManagement = async <A, E extends TeamFailure>(
  session: RequestSession,
  use: (
    management: TeamManagement["Service"],
  ) => Effect.Effect<A, E, ProvidedPerRequest | Db>,
): Promise<Result.Result<A, E | NotManager | DbFailure>> => {
  if (!isManager(session.role)) return Result.fail(new NotManager());
  return writeTeamList(
    db,
    session.companyId,
    session.companyTeamListOf,
    runInTransaction(
      session,
      TeamManagement.use(use).pipe(Effect.provide(TeamManagement.layer)),
    ),
  );
};
