import { type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import { DatabaseError } from "pg";
import { SkillId, TeamId } from "@/db/ids";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { DbUnavailable, ReadDb } from "./db-service";
import { Level } from "./level";
import { decodeTeamId, TeamNotFound, TeamServiceError } from "./team-errors";

export const Team = Schema.Struct({ id: TeamId, name: Schema.String });

export const TeamDetail = Schema.Struct({
  ...Team.fields,
  skills: Schema.Array(Schema.Struct({ id: SkillId, name: Schema.String })),
  assignedUserIds: Schema.Array(Schema.String),
  levels: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      skillId: SkillId,
      level: Level,
      wantsToLearn: Schema.Boolean,
    }),
  ),
});
type TeamDetail = typeof TeamDetail.Type;

const decodeTeamDetail = Schema.decodeUnknownEffect(Schema.NullOr(TeamDetail));
const decodeTeams = Schema.decodeUnknownEffect(Schema.Array(Team));

type RequestContext = CompanyContext | AuthorizationContext;

// drizzle は pg のエラーを cause に包む
const failureOfQuery = (cause: unknown) =>
  cause instanceof Error && cause.cause instanceof DatabaseError
    ? new TeamServiceError({ cause })
    : new DbUnavailable({ cause });

export class TeamReads extends Context.Service<
  TeamReads,
  {
    readonly listTeams: Effect.Effect<
      readonly (typeof Team.Type)[],
      TeamServiceError | DbUnavailable,
      RequestContext
    >;
    getTeam(
      teamId: string,
    ): Effect.Effect<
      TeamDetail,
      TeamNotFound | TeamServiceError | DbUnavailable,
      RequestContext
    >;
  }
>()("taimei/src/services/TeamReads") {
  static readonly layer = Layer.effect(
    TeamReads,
    Effect.gen(function* () {
      const db = yield* ReadDb;

      // 関数の値が schema に合わないのは migration と schema の食い違いなので、DB の失敗と同じに扱う
      const selectFunctionResult = <A>(
        call: SQL,
        decode: (value: unknown) => Effect.Effect<A, Schema.SchemaError>,
      ) =>
        Effect.tryPromise({
          try: () =>
            db.execute<{ result: unknown }>(sql`select ${call} as result`),
          catch: failureOfQuery,
        }).pipe(
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
        listTeams: requester.pipe(
          Effect.flatMap(({ companyId, userId, isManager }) =>
            selectFunctionResult(
              sql`team_list(${companyId}, ${userId}, ${isManager})`,
              decodeTeams,
            ),
          ),
          Effect.withSpan("TeamReads.listTeams"),
        ),

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
