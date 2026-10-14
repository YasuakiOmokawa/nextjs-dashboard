import { sql } from "drizzle-orm";
import { Context, Effect, Result, Schema } from "effect";
import type { CompanyId } from "@/db/ids";
import { reportError } from "@/src/lib/report-error";
import { writeInCompanyScope } from "./company-scope";
import type { Db } from "./db-service";
import { type DbFailure, DbUnavailable, failureOfDbError } from "./failures";
import { TeamListSnapshot, type TeamListStub } from "./team-list-store";

const CALL_TIMEOUT = "1 second";

const reportingFailure = <A, B>(
  effect: Effect.Effect<A, unknown>,
  whenUnreachable: B,
) =>
  effect.pipe(
    Effect.timeout(CALL_TIMEOUT),
    Effect.catch((failure) =>
      Effect.sync(() => {
        reportError(failure);
        return whenUnreachable;
      }),
    ),
  );

type StoredTeamList =
  | { readonly _tag: "Stored"; readonly snapshot: TeamListSnapshot }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unreachable" };

const UNREACHABLE = { _tag: "Unreachable" } as const;

const callStub = <A>(call: () => A | Promise<A>) =>
  Effect.tryPromise(async () => call());

const retryOnce = Effect.retry({ times: 1 });

export class CompanyTeamList extends Context.Service<
  CompanyTeamList,
  {
    readonly read: Effect.Effect<StoredTeamList>;
    replace(
      snapshot: TeamListSnapshot,
    ): Effect.Effect<"replaced" | "unreachable">;
    readonly clear: Effect.Effect<void>;
  }
>()("taimei/src/services/CompanyTeamList") {
  static readonly fromStub = (
    getStubWhenCalled: () => TeamListStub,
    workerVersion: string,
  ) =>
    CompanyTeamList.of({
      read: reportingFailure(
        callStub(() => getStubWhenCalled().read(workerVersion)).pipe(
          Effect.map(
            (snapshot): StoredTeamList =>
              snapshot ? { _tag: "Stored", snapshot } : { _tag: "Missing" },
          ),
        ),
        UNREACHABLE,
      ),
      replace: (snapshot) =>
        reportingFailure(
          callStub(() =>
            getStubWhenCalled().replace(workerVersion, snapshot),
          ).pipe(retryOnce, Effect.as("replaced" as const)),
          "unreachable" as const,
        ),
      clear: reportingFailure(
        callStub(() => getStubWhenCalled().clear()).pipe(
          retryOnce,
          Effect.asVoid,
        ),
        undefined,
      ),
    });
}

export const decodeTeamListSnapshot =
  Schema.decodeUnknownEffect(TeamListSnapshot);

export const rewriteTeamList = (
  teamList: CompanyTeamList["Service"],
  bumped: unknown,
) =>
  decodeTeamListSnapshot(bumped).pipe(
    Effect.flatMap(teamList.replace),
    Effect.flatMap((replaced) =>
      replaced === "unreachable" ? teamList.clear : Effect.void,
    ),
    Effect.catch((failure) =>
      Effect.sync(() => reportError(failure)).pipe(
        Effect.andThen(teamList.clear),
      ),
    ),
  );

const incrementTeamListVersion = async (
  tx: Db["Service"],
  companyId: CompanyId,
) => {
  try {
    const { rows } = await tx.execute<{ result: unknown }>(
      sql`select bump_company_team_list(${companyId}) as result`,
    );
    return Result.succeed(rows[0]?.result);
  } catch (cause) {
    return Result.fail(failureOfDbError(cause));
  }
};

// 一覧を変える書き込みの手順 (docs/adr/0008-company-teams-cache.md)
export const writeTeamList = async <A, E>(
  db: Db["Service"],
  companyId: CompanyId,
  teamListOf: (companyId: CompanyId) => CompanyTeamList["Service"],
  write: (tx: Db["Service"]) => Promise<Result.Result<A, E>>,
): Promise<Result.Result<A, E | DbFailure>> => {
  const teamList = teamListOf(companyId);
  const result = await writeInCompanyScope<
    { readonly value: A; readonly list: unknown },
    E | DbFailure
  >(db, companyId, async (tx) => {
    const written = await write(tx);
    if (Result.isFailure(written)) return Result.fail(written.failure);
    return Result.map(
      await incrementTeamListVersion(tx, companyId),
      (list) => ({
        value: written.success,
        list,
      }),
    );
  });
  if (Result.isSuccess(result))
    await Effect.runPromise(rewriteTeamList(teamList, result.success.list));
  else if (result.failure instanceof DbUnavailable)
    await Effect.runPromise(teamList.clear);
  return Result.map(result, ({ value }) => value);
};
