import { sql } from "drizzle-orm";
import { Context, Effect, Schema } from "effect";
import { type CompanyId, TeamId } from "@/db/ids";
import { reportError } from "@/src/lib/report-error";
import type { Db } from "./db-service";

export type SqlStorage = {
  exec(
    query: string,
    ...bindings: (string | number)[]
  ): { toArray(): Record<string, unknown>[] };
};

export type DurableObjectContext = {
  readonly storage: { readonly sql: SqlStorage };
};

const TeamListSnapshot = Schema.Struct({
  version: Schema.Finite,
  teams: Schema.Array(
    Schema.Struct({
      id: TeamId,
      name: Schema.String,
      assignedUserIds: Schema.Array(Schema.String),
    }),
  ),
});
export type TeamListSnapshot = typeof TeamListSnapshot.Type;

export const LIFETIME_MS = 3_600_000;

const decodeSnapshot = Schema.decodeUnknownSync(TeamListSnapshot);

export class TeamListStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS team_list (position INTEGER PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, assigned_user_ids TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS team_list_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, worker_version TEXT NOT NULL, stored_at INTEGER NOT NULL)",
    );
  }

  #storedMeta() {
    const [meta] = this.sql
      .exec("SELECT version, worker_version, stored_at FROM team_list_meta")
      .toArray();
    return meta === undefined
      ? undefined
      : {
          version: Number(meta.version),
          workerVersion: String(meta.worker_version),
          fresh: Number(meta.stored_at) > Date.now() - LIFETIME_MS,
        };
  }

  read(workerVersion: string): TeamListSnapshot | undefined {
    const meta = this.#storedMeta();
    if (!meta?.fresh || meta.workerVersion !== workerVersion) return undefined;
    try {
      const teams = this.sql
        .exec(
          "SELECT team_id, name, assigned_user_ids FROM team_list ORDER BY position",
        )
        .toArray()
        .map((row) => ({
          id: row.team_id,
          name: row.name,
          assignedUserIds: JSON.parse(String(row.assigned_user_ids)),
        }));
      return decodeSnapshot({ version: meta.version, teams });
    } catch {
      this.clear();
      return undefined;
    }
  }

  replace(workerVersion: string, { version, teams }: TeamListSnapshot) {
    const meta = this.#storedMeta();
    const sameList =
      meta?.version === version && meta.workerVersion === workerVersion;
    if (meta?.fresh && (version < meta.version || sameList)) return;
    if (sameList) {
      this.sql.exec("UPDATE team_list_meta SET stored_at = ?", Date.now());
      return;
    }
    this.clear();
    teams.forEach((team, position) =>
      this.sql.exec(
        "INSERT INTO team_list (position, team_id, name, assigned_user_ids) VALUES (?, ?, ?, ?)",
        position,
        team.id,
        team.name,
        JSON.stringify(team.assignedUserIds),
      ),
    );
    this.sql.exec(
      "INSERT INTO team_list_meta (id, version, worker_version, stored_at) VALUES (1, ?, ?, ?)",
      version,
      workerVersion,
      Date.now(),
    );
  }

  clear() {
    this.sql.exec("DELETE FROM team_list");
    this.sql.exec("DELETE FROM team_list_meta");
  }
}

export type TeamListStub = {
  read(
    workerVersion: string,
  ): TeamListSnapshot | undefined | Promise<TeamListSnapshot | undefined>;
  replace(
    workerVersion: string,
    snapshot: TeamListSnapshot,
  ): void | Promise<void>;
  clear(): void | Promise<void>;
};

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

export const bumpTeamListInWriteTransaction = async (
  writeTransaction: Pick<Db["Service"], "execute">,
  companyId: CompanyId,
) =>
  (
    await writeTransaction.execute<{ result: unknown }>(
      sql`select bump_company_team_list(${companyId}) as result`,
    )
  ).rows[0]?.result;

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
