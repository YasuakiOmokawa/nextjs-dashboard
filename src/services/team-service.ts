import { and, eq, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  MEMBER_SKILLS_ASSIGNMENT_FK,
  MEMBER_SKILLS_SKILL_FK,
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { SkillId } from "@/db/ids";
import { companyFilter } from "@/db/scoped";
import { AuthorizationContext, isManager } from "./authorization-context";
import { CompanyContext } from "./company-context";
import {
  CompanyMembers,
  type MemberListError,
  type Unauthenticated,
} from "./company-members-service";
import { Db } from "./db-service";
import { LevelFromForm } from "./level";
import {
  DuplicateName,
  decodeTeamId,
  InvalidLevel,
  InvalidName,
  NotAssigned,
  NotCompanyMember,
  NotManager,
  SkillNotFound,
  TeamNotFound,
  TeamServiceError,
} from "./team-errors";
import { TeamOrSkillName } from "./team-or-skill-name";

const runQuery = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new TeamServiceError({ cause }),
  });

const decodeUnknownSkillId = Schema.decodeUnknownEffect(SkillId);
const decodeSkillId = (skillId: string) =>
  decodeUnknownSkillId(skillId).pipe(
    Effect.mapError(() => new SkillNotFound()),
  );

const decodeTeamOrSkillName = Schema.decodeUnknownEffect(TeamOrSkillName);
const decodeName = (name: string) =>
  decodeTeamOrSkillName(name).pipe(Effect.mapError(() => new InvalidName()));

const decodeLevelFromForm = Schema.decodeUnknownEffect(LevelFromForm);
const decodeLevel = (level: string) =>
  decodeLevelFromForm(level).pipe(Effect.mapError(() => new InvalidLevel()));

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CARDINALITY_VIOLATION = "21000";
const INSUFFICIENT_PRIVILEGE = "42501";
// PostgreSQL は RLS の policy の違反も権限の不足も 42501 で返し、翻訳されない routine (関数名) だけが分かれる
const RLS_POLICY_VIOLATION_ROUTINE = "ExecWithCheckOptions";

// drizzle は pg のエラーを cause に包む
const ErrorWithPgCause = Schema.Struct({
  cause: Schema.Struct({
    code: Schema.optional(Schema.String),
    constraint: Schema.optional(Schema.String),
    routine: Schema.optional(Schema.String),
  }),
});
type Violation = (typeof ErrorWithPgCause.Type)["cause"];

const decodeErrorWithPgCause = Schema.decodeUnknownOption(ErrorWithPgCause);
const violationOf = (error: unknown): Violation =>
  Option.getOrUndefined(decodeErrorWithPgCause(error))?.cause ?? {};

type LevelEntry = {
  readonly skillId: string;
  readonly level: string;
  readonly wantsToLearn: boolean;
};

// 違反で外側の transaction を中断しないよう、savepoint の中で書く
const runWrite = <A, E>(
  db: Db["Service"],
  run: (tx: Db["Service"]) => Promise<A>,
  failureOf: (violation: Violation) => E | undefined,
) =>
  Effect.tryPromise({
    try: () => db.transaction(run),
    catch: (cause) =>
      failureOf(violationOf(cause)) ?? new TeamServiceError({ cause }),
  });

const nameWriteFailure = ({ code }: Violation) =>
  code === UNIQUE_VIOLATION ? new DuplicateName() : undefined;

const levelWriteFailure = ({ code, constraint, routine }: Violation) => {
  if (code === CARDINALITY_VIOLATION) return new InvalidLevel();
  if (constraint === MEMBER_SKILLS_ASSIGNMENT_FK) return new NotAssigned();
  if (constraint === MEMBER_SKILLS_SKILL_FK) return new SkillNotFound();
  // 別の事業所の行と主キーが重なる ON CONFLICT は、その行が RLS で見えず policy の違反になる
  if (
    code === INSUFFICIENT_PRIVILEGE &&
    routine === RLS_POLICY_VIOLATION_ROUTINE
  )
    return new SkillNotFound();
  return undefined;
};

const missingTeam = (teamId: string, { code }: Violation) =>
  code === FOREIGN_KEY_VIOLATION ? new TeamNotFound({ teamId }) : undefined;

const findTeam = Effect.fnUntraced(function* (
  db: Db["Service"],
  teamId: string,
  narrowing?: SQL,
) {
  const id = yield* decodeTeamId(teamId);
  const { companyId } = yield* CompanyContext;
  const [team] = yield* runQuery(() =>
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, id), companyFilter(teams, companyId), narrowing)),
  );
  if (!team) return yield* new TeamNotFound({ teamId });
  return team;
});

type RequestContext = CompanyContext | AuthorizationContext;

export class TeamService extends Context.Service<
  TeamService,
  {
    saveMyLevels(
      teamId: string,
      entries: readonly LevelEntry[],
    ): Effect.Effect<
      void,
      | TeamNotFound
      | NotAssigned
      | InvalidLevel
      | SkillNotFound
      | TeamServiceError,
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
            levelWriteFailure,
          );
        }),
      });
    }),
  );
}

export class TeamManagement extends Context.Service<
  TeamManagement,
  {
    createTeam(
      name: string,
    ): Effect.Effect<
      { readonly id: string },
      InvalidName | DuplicateName | TeamServiceError,
      CompanyContext
    >;
    renameTeam(
      teamId: string,
      name: string,
    ): Effect.Effect<
      void,
      InvalidName | TeamNotFound | DuplicateName | TeamServiceError,
      CompanyContext
    >;
    deleteTeam(
      teamId: string,
    ): Effect.Effect<void, TeamNotFound | TeamServiceError, CompanyContext>;
    addSkill(
      teamId: string,
      name: string,
    ): Effect.Effect<
      void,
      InvalidName | TeamNotFound | DuplicateName | TeamServiceError,
      CompanyContext
    >;
    removeSkill(
      skillId: string,
    ): Effect.Effect<void, SkillNotFound | TeamServiceError, CompanyContext>;
    assign(
      teamId: string,
      userId: string,
    ): Effect.Effect<
      void,
      | TeamNotFound
      | MemberListError
      | Unauthenticated
      | NotCompanyMember
      | TeamServiceError,
      CompanyContext
    >;
    unassign(
      teamId: string,
      userId: string,
    ): Effect.Effect<void, TeamNotFound | TeamServiceError, CompanyContext>;
  }
>()("taimei/src/services/TeamManagement") {
  static readonly layer = Layer.effect(
    TeamManagement,
    Effect.gen(function* () {
      const { role } = yield* AuthorizationContext;
      if (!isManager(role)) return yield* new NotManager();
      const db = yield* Db;
      const companyMembers = yield* CompanyMembers;

      const runNameWrite = <A>(run: (tx: typeof db) => Promise<A>) =>
        runWrite(db, run, nameWriteFailure);

      return TeamManagement.of({
        createTeam: Effect.fn("TeamManagement.createTeam")(function* (
          name: string,
        ) {
          const validName = yield* decodeName(name);
          const { companyId } = yield* CompanyContext;
          const [team] = yield* runNameWrite((tx) =>
            tx
              .insert(teams)
              .values({ companyId, name: validName })
              .returning({ id: teams.id }),
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
          const updated = yield* runNameWrite((tx) =>
            tx
              .update(teams)
              .set({ name: validName })
              .where(and(eq(teams.id, id), companyFilter(teams, companyId)))
              .returning({ id: teams.id }),
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
            (violation) =>
              missingTeam(teamId, violation) ?? nameWriteFailure(violation),
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
            (violation) => missingTeam(teamId, violation),
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
