import { type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import { Team, TeamDetail, TeamNotFound } from "@/src/spa-contract";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { CompanyTeamList, decodeTeamListSnapshot } from "./company-team-list";
import { ReadDb } from "./db-service";
import { type DbFailure, TeamServiceError } from "./failures";
import { decodeTeamId, runQuery } from "./team-queries";

type TeamDetail = typeof TeamDetail.Type;

const decodeTeamDetail = Schema.decodeUnknownEffect(Schema.NullOr(TeamDetail));

type RequestContext = CompanyContext | AuthorizationContext;

export class TeamReads extends Context.Service<
  TeamReads,
  {
    readonly listTeams: Effect.Effect<
      readonly (typeof Team.Type)[],
      DbFailure,
      RequestContext
    >;
    getTeam(
      teamId: string,
    ): Effect.Effect<TeamDetail, TeamNotFound | DbFailure, RequestContext>;
  }
>()("taimei/src/services/TeamReads") {
  static readonly layer = Layer.effect(
    TeamReads,
    Effect.gen(function* () {
      const db = yield* ReadDb;
      const teamList = yield* CompanyTeamList;

      // 関数の値が schema に合わないのは migration と schema の食い違いなので、DB の失敗と同じに扱う
      const selectFunctionResult = <A>(
        call: SQL,
        decode: (value: unknown) => Effect.Effect<A, Schema.SchemaError>,
      ) =>
        runQuery(() =>
          db.execute<{ result: unknown }>(sql`select ${call} as result`),
        ).pipe(
          Effect.flatMap(({ rows }) =>
            decode(rows[0]?.result).pipe(
              Effect.mapError((cause) => new TeamServiceError({ cause })),
            ),
          ),
        );

      const requester = Effect.gen(function* () {
        const { companyId } = yield* CompanyContext;
        const { userId, role } = yield* AuthorizationContext;
        return { companyId, userId, isManager: isManager(role) };
      });

      return TeamReads.of({
        listTeams: Effect.gen(function* () {
          const { companyId, userId, isManager } = yield* requester;
          const stored = yield* teamList.read;
          const snapshot =
            stored._tag === "Stored"
              ? stored.snapshot
              : yield* selectFunctionResult(
                  sql`company_team_list(${companyId})`,
                  decodeTeamListSnapshot,
                );
          if (stored._tag === "Missing") yield* teamList.replace(snapshot);
          return snapshot.teams.filter(
            (team) => isManager || team.assignedUserIds.includes(userId),
          );
        }).pipe(Effect.withSpan("TeamReads.listTeams")),

        getTeam: Effect.fn("TeamReads.getTeam")(function* (teamId: string) {
          const id = yield* decodeTeamId(teamId);
          const { companyId, userId, isManager } = yield* requester;
          const team = yield* selectFunctionResult(
            sql`team_matrix(${companyId}, ${id}, ${userId}, ${isManager})`,
            decodeTeamDetail,
          );
          if (!team) return yield* new TeamNotFound({ teamId });
          return team;
        }),
      });
    }),
  );
}
