import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import {
  MEMBER_SKILLS_ASSIGNMENT_FK,
  MEMBER_SKILLS_SKILL_FK,
  memberSkills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { companyFilter } from "@/db/scoped";
import {
  InvalidLevel,
  Level,
  type LevelEntry,
  NotAssigned,
  type SkillNotFound,
  type TeamNotFound,
} from "@/src/spa-contract";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { Db } from "./db-service";
import type { DbFailure } from "./failures";
import {
  decodeSkillId,
  findTeam,
  RLS_POLICY_VIOLATION,
  runQuery,
  runWrite,
} from "./team-queries";

const decodeUnknownLevel = Schema.decodeUnknownEffect(Level);
const decodeLevel = (level: number) =>
  decodeUnknownLevel(level).pipe(Effect.mapError(() => new InvalidLevel()));

type RequestContext = CompanyContext | AuthorizationContext;

export class TeamService extends Context.Service<
  TeamService,
  {
    saveMyLevels(
      teamId: string,
      entries: readonly LevelEntry[],
    ): Effect.Effect<
      void,
      TeamNotFound | NotAssigned | InvalidLevel | SkillNotFound | DbFailure,
      RequestContext
    >;
  }
>()("taimei/src/services/TeamService") {
  static readonly layer = Layer.effect(
    TeamService,
    Effect.gen(function* () {
      const db = yield* Db;

      const visibleTeamCondition = Effect.gen(function* () {
        const { companyId } = yield* CompanyContext;
        const { userId, role } = yield* AuthorizationContext;
        return sql`team_visible_to(${companyId}, ${teams.id}, ${userId}, ${isManager(role)})`;
      });

      const findVisibleTeam = (teamId: string) =>
        visibleTeamCondition.pipe(
          Effect.flatMap((visible) => findTeam(db, teamId, visible)),
        );

      return TeamService.of({
        saveMyLevels: Effect.fn("TeamService.saveMyLevels")(function* (
          teamId: string,
          entries: readonly LevelEntry[],
        ) {
          const team = yield* findVisibleTeam(teamId);
          const { userId } = yield* AuthorizationContext;
          const { companyId } = yield* CompanyContext;
          const levels = yield* Effect.forEach(entries, (entry) =>
            decodeLevel(entry.level),
          );
          const skillIds = yield* Effect.forEach(entries, (entry) =>
            decodeSkillId(entry.skillId),
          );
          // 同じスキルを 2 回送ると、1 文の ON CONFLICT が同じ行を 2 回更新できず、名前の無い違反 (21000) になる
          if (
            new Set(skillIds.map((id) => id.toLowerCase())).size <
            skillIds.length
          )
            return yield* new InvalidLevel();
          if (entries.length === 0) {
            const [assignment] = yield* runQuery(() =>
              db
                .select({ userId: teamAssignments.userId })
                .from(teamAssignments)
                .where(
                  and(
                    eq(teamAssignments.teamId, team.id),
                    eq(teamAssignments.userId, userId),
                    companyFilter(teamAssignments, companyId),
                  ),
                ),
            );
            if (!assignment) return yield* new NotAssigned();
            return;
          }
          yield* runWrite(
            db,
            (tx) =>
              tx
                .insert(memberSkills)
                .values(
                  entries.map((entry, i) => ({
                    companyId,
                    teamId: team.id,
                    skillId: skillIds[i],
                    userId,
                    level: levels[i],
                    wantsToLearn: entry.wantsToLearn,
                  })),
                )
                .onConflictDoUpdate({
                  target: [memberSkills.skillId, memberSkills.userId],
                  set: {
                    // キー列が変わらない UPDATE は FK を検査しないので、team_id を書き直して別チームの行の上書きを FK で止める
                    teamId: sql.raw(`excluded.${memberSkills.teamId.name}`),
                    level: sql.raw(`excluded.${memberSkills.level.name}`),
                    wantsToLearn: sql.raw(
                      `excluded.${memberSkills.wantsToLearn.name}`,
                    ),
                    updatedAt: sql`now()`,
                  },
                }),
            [
              MEMBER_SKILLS_ASSIGNMENT_FK,
              MEMBER_SKILLS_SKILL_FK,
              RLS_POLICY_VIOLATION,
            ],
          );
        }),
      });
    }),
  );
}
