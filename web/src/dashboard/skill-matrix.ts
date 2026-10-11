import type { TeamPage } from "../api";
import type { Level } from "./level";

export type TeamDetail = TeamPage["team"];
export type Member = NonNullable<TeamPage["members"]>[number];
type Skill = TeamDetail["skills"][number];

export type Cell = {
  readonly skill: Skill;
  readonly level: Level;
  readonly wantsToLearn: boolean;
  readonly recorded: boolean;
};

type SkillSummary = {
  readonly skill: Skill;
  readonly isBiased: boolean;
  readonly wantsToLearnCount: number;
};

type Assignment = {
  readonly assigned: readonly Member[];
  readonly candidates: readonly Member[];
  readonly departedUserIds: readonly string[];
};

export type Roster =
  | { readonly _tag: "MembersUnavailable" }
  | (Assignment & { readonly _tag: "MatrixIncomplete" })
  | (Assignment & {
      readonly _tag: "MatrixReady";
      readonly rows: readonly {
        readonly member: Member;
        readonly cells: readonly Cell[];
      }[];
      readonly summaries: readonly SkillSummary[];
    });

export const BIAS_RULE = { atOrAboveLevel: 2, atMostPeople: 1 } as const;

const canDoAlone = (level: Level) => level >= BIAS_RULE.atOrAboveLevel;

const summaryOf = (skill: Skill, column: readonly Cell[]): SkillSummary => ({
  skill,
  isBiased:
    column.filter((cell) => canDoAlone(cell.level)).length <=
    BIAS_RULE.atMostPeople,
  wantsToLearnCount: column.filter((cell) => cell.wantsToLearn).length,
});

export const teamSkillMatrix = (
  team: TeamDetail,
  members: readonly Member[] | null,
  myUserId: string,
): { readonly myCells: readonly Cell[]; readonly roster: Roster } => {
  const recordedLevels = new Map(
    team.levels.map((record) => [`${record.userId}/${record.skillId}`, record]),
  );
  const cellOf = (userId: string, skill: Skill): Cell => {
    const record = recordedLevels.get(`${userId}/${skill.id}`);
    return {
      skill,
      level: record?.level ?? 0,
      wantsToLearn: record?.wantsToLearn ?? false,
      recorded: record !== undefined,
    };
  };
  const cellsOf = (userId: string) =>
    team.skills.map((skill) => cellOf(userId, skill));
  const assignedIds = new Set(team.assignedUserIds);
  const myCells = assignedIds.has(myUserId) ? cellsOf(myUserId) : [];
  if (!members) return { myCells, roster: { _tag: "MembersUnavailable" } };

  const memberIds = new Set(members.map((m) => m.userId));
  const assigned = members.filter((m) => assignedIds.has(m.userId));
  const assignment: Assignment = {
    assigned,
    candidates: members.filter((m) => !assignedIds.has(m.userId)),
    departedUserIds: team.assignedUserIds.filter((id) => !memberIds.has(id)),
  };
  if (team.skills.length === 0 || assigned.length === 0)
    return { myCells, roster: { _tag: "MatrixIncomplete", ...assignment } };
  return {
    myCells,
    roster: {
      _tag: "MatrixReady",
      ...assignment,
      rows: assigned.map((member) => ({
        member,
        cells: cellsOf(member.userId),
      })),
      summaries: team.skills.map((skill) =>
        summaryOf(
          skill,
          assigned.map((member) => cellOf(member.userId, skill)),
        ),
      ),
    },
  };
};
