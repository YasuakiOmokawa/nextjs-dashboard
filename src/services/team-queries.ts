import { and, eq, type SQL } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  MEMBER_SKILLS_ASSIGNMENT_FK,
  MEMBER_SKILLS_SKILL_FK,
  SKILLS_NAME_UNIQUE,
  SKILLS_TEAM_FK,
  TEAM_ASSIGNMENTS_TEAM_FK,
  TEAMS_NAME_UNIQUE,
  teams,
} from "@/db/drizzle/schema";
import { SkillId, TeamId } from "@/db/ids";
import { companyFilter } from "@/db/scoped";
import {
  DuplicateName,
  NotAssigned,
  SkillNotFound,
  TeamNotFound,
} from "@/src/spa-contract";
import { CompanyContext } from "./company-context";
import type { Db } from "./db-service";
import { type DbFailure, failureOfDbError, pgErrorOf } from "./failures";

const decodeUnknownTeamId = Schema.decodeUnknownEffect(TeamId);
export const decodeTeamId = (teamId: string) =>
  decodeUnknownTeamId(teamId).pipe(
    Effect.mapError(() => new TeamNotFound({ teamId })),
  );

const decodeUnknownSkillId = Schema.decodeUnknownEffect(SkillId);
export const decodeSkillId = (skillId: string) =>
  decodeUnknownSkillId(skillId).pipe(
    Effect.mapError(() => new SkillNotFound()),
  );

export const runQuery = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: failureOfDbError });

// RLS の policy の違反は制約名を持たない。PostgreSQL は権限の不足と同じ 42501 で返し、翻訳されない routine (関数名) だけが分かれる
export const RLS_POLICY_VIOLATION = "rls_policy_violation";
const INSUFFICIENT_PRIVILEGE = "42501";
const RLS_POLICY_VIOLATION_ROUTINE = "ExecWithCheckOptions";

type TeamSubject = { readonly teamId: string };

type FailureByViolation = {
  [TEAMS_NAME_UNIQUE]: DuplicateName;
  [SKILLS_NAME_UNIQUE]: DuplicateName;
  [SKILLS_TEAM_FK]: TeamNotFound;
  [TEAM_ASSIGNMENTS_TEAM_FK]: TeamNotFound;
  [MEMBER_SKILLS_ASSIGNMENT_FK]: NotAssigned;
  [MEMBER_SKILLS_SKILL_FK]: SkillNotFound;
  // 別の事業所の行と主キーが重なる ON CONFLICT は、その行が RLS で見えず policy の違反になる
  [RLS_POLICY_VIOLATION]: SkillNotFound;
};
type ViolationName = keyof FailureByViolation;
type TeamFk = typeof SKILLS_TEAM_FK | typeof TEAM_ASSIGNMENTS_TEAM_FK;

const failureByViolation: {
  readonly [Name in ViolationName]: (
    subject: TeamSubject | undefined,
  ) => FailureByViolation[Name] | undefined;
} = {
  [TEAMS_NAME_UNIQUE]: () => new DuplicateName(),
  [SKILLS_NAME_UNIQUE]: () => new DuplicateName(),
  [SKILLS_TEAM_FK]: (subject) => subject && new TeamNotFound(subject),
  [TEAM_ASSIGNMENTS_TEAM_FK]: (subject) => subject && new TeamNotFound(subject),
  [MEMBER_SKILLS_ASSIGNMENT_FK]: () => new NotAssigned(),
  [MEMBER_SKILLS_SKILL_FK]: () => new SkillNotFound(),
  [RLS_POLICY_VIOLATION]: () => new SkillNotFound(),
};

type SubjectFor<Name extends ViolationName> = [Extract<Name, TeamFk>] extends [
  never,
]
  ? []
  : [subject: TeamSubject];

const violationNameOf = (cause: unknown) => {
  const error = pgErrorOf(cause);
  return error?.code === INSUFFICIENT_PRIVILEGE &&
    error.routine === RLS_POLICY_VIOLATION_ROUTINE
    ? RLS_POLICY_VIOLATION
    : error?.constraint;
};

export const failureOfWrite = <Name extends ViolationName>(
  cause: unknown,
  expected: readonly Name[],
  ...[subject]: SubjectFor<Name>
): FailureByViolation[Name] | DbFailure => {
  const name = violationNameOf(cause);
  const expectedName = expected.find((candidate) => candidate === name);
  return (
    (expectedName && failureByViolation[expectedName](subject)) ??
    failureOfDbError(cause)
  );
};

// 違反で外側の transaction を中断しないよう、savepoint の中で書く
export const runWrite = <A, Name extends ViolationName>(
  db: Db["Service"],
  run: (tx: Db["Service"]) => Promise<A>,
  expected: readonly Name[],
  ...subject: SubjectFor<Name>
) =>
  Effect.tryPromise({
    try: () => db.transaction(run),
    catch: (cause) => failureOfWrite(cause, expected, ...subject),
  });

export const findTeam = Effect.fnUntraced(function* (
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
