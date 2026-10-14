import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import {
  MEMBER_SKILLS_ASSIGNMENT_FK,
  MEMBER_SKILLS_SKILL_FK,
  SKILLS_NAME_UNIQUE,
  SKILLS_TEAM_FK,
  TEAM_ASSIGNMENTS_TEAM_FK,
  TEAMS_NAME_UNIQUE,
} from "@/db/drizzle/schema";
import {
  DuplicateName,
  NotAssigned,
  SkillNotFound,
  TeamNotFound,
} from "@/src/spa-contract";
import { failureOfDbError } from "../failures";
import { failureOfWrite, RLS_POLICY_VIOLATION } from "../team-queries";

// drizzle は pg のエラーを cause に包む
const writeError = (fields: {
  code: string;
  constraint?: string;
  routine?: string;
}) =>
  new Error("Failed query", {
    cause: Object.assign(new DatabaseError("violation", 0, "error"), fields),
  });

const subject = { teamId: "team-1" };

describe("違反の名前で引く表", () => {
  it.each([
    [
      TEAMS_NAME_UNIQUE,
      { code: "23505", constraint: TEAMS_NAME_UNIQUE },
      new DuplicateName(),
    ],
    [
      SKILLS_NAME_UNIQUE,
      { code: "23505", constraint: SKILLS_NAME_UNIQUE },
      new DuplicateName(),
    ],
    [
      SKILLS_TEAM_FK,
      { code: "23503", constraint: SKILLS_TEAM_FK },
      new TeamNotFound(subject),
    ],
    [
      TEAM_ASSIGNMENTS_TEAM_FK,
      { code: "23503", constraint: TEAM_ASSIGNMENTS_TEAM_FK },
      new TeamNotFound(subject),
    ],
    [
      MEMBER_SKILLS_ASSIGNMENT_FK,
      { code: "23503", constraint: MEMBER_SKILLS_ASSIGNMENT_FK },
      new NotAssigned(),
    ],
    [
      MEMBER_SKILLS_SKILL_FK,
      { code: "23503", constraint: MEMBER_SKILLS_SKILL_FK },
      new SkillNotFound(),
    ],
    [
      RLS_POLICY_VIOLATION,
      { code: "42501", routine: "ExecWithCheckOptions" },
      new SkillNotFound(),
    ],
  ] as const)(
    "%s を期待した書き込みの違反は、表の失敗に写す",
    (name, fields, failure) => {
      expect(failureOfWrite(writeError(fields), [name], subject)).toEqual(
        failure,
      );
    },
  );
});

describe("表で引けない違反は、予期しない失敗にする", () => {
  it.each([
    [
      "期待に無い制約名の unique",
      writeError({ code: "23505", constraint: "teams_other_unique" }),
    ],
    [
      "期待に無い制約名の FK",
      writeError({ code: "23503", constraint: "skills_other_fk" }),
    ],
    [
      "名前の無い 21000 (同じ行を 2 回 ON CONFLICT で更新)",
      writeError({ code: "21000" }),
    ],
    [
      "RLS でない 42501 (権限の不足)",
      writeError({ code: "42501", routine: "aclcheck_error" }),
    ],
    [
      "RLS の違反を表す名と同じ文字列の制約名",
      writeError({ code: "23503", constraint: "rls_policy_violation" }),
    ],
  ])("%s", (_, cause) => {
    expect(
      failureOfWrite(
        cause,
        [
          TEAMS_NAME_UNIQUE,
          SKILLS_TEAM_FK,
          MEMBER_SKILLS_SKILL_FK,
          RLS_POLICY_VIOLATION,
        ],
        subject,
      ),
    ).toEqual(failureOfDbError(cause));
  });

  it("表にある名前でも、書き込みが期待していなければ予期しない失敗にする", () => {
    const cause = writeError({ code: "23505", constraint: SKILLS_NAME_UNIQUE });

    expect(failureOfWrite(cause, [TEAMS_NAME_UNIQUE])).toEqual(
      failureOfDbError(cause),
    );
  });
});

it("チームの FK を期待する時だけ subject を渡す (bun run typecheck で見る)", () => {
  const cause = writeError({ code: "23503", constraint: SKILLS_TEAM_FK });
  // @ts-expect-error チームの FK を期待するなら、TeamNotFound の teamId が要る
  failureOfWrite(cause, [SKILLS_TEAM_FK, SKILLS_NAME_UNIQUE]);
  // @ts-expect-error チームの FK を期待しないなら、subject は渡せない
  failureOfWrite(cause, [TEAMS_NAME_UNIQUE], subject);
});
