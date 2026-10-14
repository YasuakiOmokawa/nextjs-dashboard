import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import {
  SKILLS_NAME_UNIQUE,
  SKILLS_TEAM_FK,
  skills,
  TEAM_ASSIGNMENTS_TEAM_FK,
  TEAMS_NAME_UNIQUE,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { companyFilter } from "@/db/scoped";
import {
  type DuplicateName,
  InvalidName,
  NotCompanyMember,
  NotManager,
  SkillNotFound,
  TeamNotFound,
  type Unauthenticated,
} from "@/src/spa-contract";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import { CompanyMembers } from "./company-members-service";
import { Db } from "./db-service";
import type { DbFailure, MemberListError } from "./failures";
import { TeamOrSkillName } from "./team-or-skill-name";
import {
  decodeSkillId,
  decodeTeamId,
  findTeam,
  runQuery,
  runWrite,
} from "./team-queries";

const decodeTeamOrSkillName = Schema.decodeUnknownEffect(TeamOrSkillName);
const decodeName = (name: string) =>
  decodeTeamOrSkillName(name).pipe(Effect.mapError(() => new InvalidName()));

export class TeamManagement extends Context.Service<
  TeamManagement,
  {
    createTeam(
      name: string,
    ): Effect.Effect<
      { readonly id: string },
      InvalidName | DuplicateName | DbFailure,
      CompanyContext
    >;
    renameTeam(
      teamId: string,
      name: string,
    ): Effect.Effect<
      void,
      InvalidName | TeamNotFound | DuplicateName | DbFailure,
      CompanyContext
    >;
    deleteTeam(
      teamId: string,
    ): Effect.Effect<void, TeamNotFound | DbFailure, CompanyContext>;
    addSkill(
      teamId: string,
      name: string,
    ): Effect.Effect<
      void,
      InvalidName | TeamNotFound | DuplicateName | DbFailure,
      CompanyContext
    >;
    removeSkill(
      skillId: string,
    ): Effect.Effect<void, SkillNotFound | DbFailure, CompanyContext>;
    assign(
      teamId: string,
      userId: string,
    ): Effect.Effect<
      void,
      | TeamNotFound
      | MemberListError
      | Unauthenticated
      | NotCompanyMember
      | DbFailure,
      CompanyContext
    >;
    unassign(
      teamId: string,
      userId: string,
    ): Effect.Effect<void, TeamNotFound | DbFailure, CompanyContext>;
  }
>()("taimei/src/services/TeamManagement") {
  static readonly layer = Layer.effect(
    TeamManagement,
    Effect.gen(function* () {
      const { role } = yield* AuthorizationContext;
      if (!isManager(role)) return yield* new NotManager();
      const db = yield* Db;
      const companyMembers = yield* CompanyMembers;

      return TeamManagement.of({
        createTeam: Effect.fn("TeamManagement.createTeam")(function* (
          name: string,
        ) {
          const validName = yield* decodeName(name);
          const { companyId } = yield* CompanyContext;
          const [team] = yield* runWrite(
            db,
            (tx) =>
              tx
                .insert(teams)
                .values({ companyId, name: validName })
                .returning({ id: teams.id }),
            [TEAMS_NAME_UNIQUE],
          );
          return team;
        }),

        renameTeam: Effect.fn("TeamManagement.renameTeam")(function* (
          teamId: string,
          name: string,
        ) {
          const validName = yield* decodeName(name);
          const id = yield* decodeTeamId(teamId);
          const { companyId } = yield* CompanyContext;
          const updated = yield* runWrite(
            db,
            (tx) =>
              tx
                .update(teams)
                .set({ name: validName })
                .where(and(eq(teams.id, id), companyFilter(teams, companyId)))
                .returning({ id: teams.id }),
            [TEAMS_NAME_UNIQUE],
          );
          if (updated.length === 0) return yield* new TeamNotFound({ teamId });
        }),

        deleteTeam: Effect.fn("TeamManagement.deleteTeam")(function* (
          teamId: string,
        ) {
          const id = yield* decodeTeamId(teamId);
          const { companyId } = yield* CompanyContext;
          const deleted = yield* runQuery(() =>
            db
              .delete(teams)
              .where(and(eq(teams.id, id), companyFilter(teams, companyId)))
              .returning({ id: teams.id }),
          );
          if (deleted.length === 0) return yield* new TeamNotFound({ teamId });
        }),

        addSkill: Effect.fn("TeamManagement.addSkill")(function* (
          teamId: string,
          name: string,
        ) {
          const validName = yield* decodeName(name);
          const team = yield* findTeam(db, teamId);
          const { companyId } = yield* CompanyContext;
          yield* runWrite(
            db,
            (tx) =>
              tx
                .insert(skills)
                .values({ companyId, teamId: team.id, name: validName }),
            [SKILLS_TEAM_FK, SKILLS_NAME_UNIQUE],
            { teamId },
          );
        }),

        removeSkill: Effect.fn("TeamManagement.removeSkill")(function* (
          skillId: string,
        ) {
          const id = yield* decodeSkillId(skillId);
          const { companyId } = yield* CompanyContext;
          const deleted = yield* runQuery(() =>
            db
              .delete(skills)
              .where(and(eq(skills.id, id), companyFilter(skills, companyId)))
              .returning({ id: skills.id }),
          );
          if (deleted.length === 0) return yield* new SkillNotFound();
        }),

        assign: Effect.fn("TeamManagement.assign")(function* (
          teamId: string,
          userId: string,
        ) {
          const team = yield* findTeam(db, teamId);
          // taimei に membership の表は無いので、帰属は taimei-auth の一覧で確かめる (ADR-0002 D2 の外部参照の検証)
          const members = yield* companyMembers.list;
          if (!members.some((member) => member.userId === userId))
            return yield* new NotCompanyMember({ userId });
          const { companyId } = yield* CompanyContext;
          yield* runWrite(
            db,
            (tx) =>
              tx
                .insert(teamAssignments)
                .values({ companyId, teamId: team.id, userId })
                .onConflictDoNothing(),
            [TEAM_ASSIGNMENTS_TEAM_FK],
            { teamId },
          );
        }),

        unassign: Effect.fn("TeamManagement.unassign")(function* (
          teamId: string,
          userId: string,
        ) {
          const team = yield* findTeam(db, teamId);
          const { companyId } = yield* CompanyContext;
          yield* runQuery(() =>
            db
              .delete(teamAssignments)
              .where(
                and(
                  eq(teamAssignments.teamId, team.id),
                  eq(teamAssignments.userId, userId),
                  companyFilter(teamAssignments, companyId),
                ),
              ),
          );
        }),
      });
    }),
  );
}
