import { expect, it } from "vitest";
import type { Level } from "../level";
import { type Member, type TeamDetail, teamSkillMatrix } from "../skill-matrix";

const member = (userId: string): Member => ({ userId, name: userId });

const skill = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `スキル${n}`,
});

const recorded = (
  userId: string,
  { id }: { id: string },
  level: Level,
  wantsToLearn = false,
) => ({ userId, skillId: id, level, wantsToLearn });

const team = (detail: Partial<TeamDetail>): TeamDetail => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  name: "開発",
  skills: [],
  assignedUserIds: [],
  levels: [],
  ...detail,
});

const tableOf = ({ roster }: ReturnType<typeof teamSkillMatrix>) => {
  if (roster._tag !== "MatrixReady") throw new Error(roster._tag);
  return roster;
};

const tableWithAssignedAsMembers = (
  detail: Partial<TeamDetail> & { assignedUserIds: readonly string[] },
) =>
  tableOf(
    teamSkillMatrix(
      team(detail),
      detail.assignedUserIds.map(member),
      detail.assignedUserIds[0],
    ),
  );

it("行はメンバー一覧の順、セルはスキルの順で自分のスキルを持ち、記入の無いセルは未記入の未経験・学びたいなし", () => {
  const [s1, s2] = [skill(1), skill(2)];

  const { rows } = tableOf(
    teamSkillMatrix(
      team({
        skills: [s1, s2],
        assignedUserIds: ["u_1", "u_2"],
        levels: [recorded("u_1", s2, 3, true), recorded("u_2", s1, 1)],
      }),
      [member("u_2"), member("u_1")],
      "u_1",
    ),
  );

  expect(rows).toEqual([
    {
      member: member("u_2"),
      cells: [
        { skill: s1, level: 1, wantsToLearn: false, recorded: true },
        { skill: s2, level: 0, wantsToLearn: false, recorded: false },
      ],
    },
    {
      member: member("u_1"),
      cells: [
        { skill: s1, level: 0, wantsToLearn: false, recorded: false },
        { skill: s2, level: 3, wantsToLearn: true, recorded: true },
      ],
    },
  ]);
});

it("一人でできる以上が 0 人と 1 人のスキルは偏り、2 人なら偏りでない。△ は数えず ◎ は数える。集計はスキルの順", () => {
  const [none, one, two, weak] = [skill(1), skill(2), skill(3), skill(4)];

  const { summaries } = tableWithAssignedAsMembers({
    skills: [none, one, two, weak],
    assignedUserIds: ["u_1", "u_2"],
    levels: [
      recorded("u_1", one, 2),
      recorded("u_1", two, 2),
      recorded("u_2", two, 3),
      recorded("u_1", weak, 1),
      recorded("u_2", weak, 1),
    ],
  });

  expect(summaries.map((summary) => summary.skill)).toEqual([
    none,
    one,
    two,
    weak,
  ]);
  expect(summaries.map((summary) => summary.isBiased)).toEqual([
    true,
    true,
    false,
    true,
  ]);
});

it("スキルごとに学びたいメンバーを数え、未経験 (0) の人も数える", () => {
  const [s1, s2] = [skill(1), skill(2)];

  const { summaries } = tableWithAssignedAsMembers({
    skills: [s1, s2],
    assignedUserIds: ["u_1", "u_2"],
    levels: [
      recorded("u_1", s1, 0, true),
      recorded("u_2", s1, 3, true),
      recorded("u_1", s2, 2),
    ],
  });

  expect(summaries.map((summary) => summary.wantsToLearnCount)).toEqual([2, 0]);
});

it("割り当てたが事業所にいない人の記入は、行にも偏りにも学びたいの人数にも入れない", () => {
  const s1 = skill(1);
  const matrixOf = (levels: TeamDetail["levels"]) =>
    tableOf(
      teamSkillMatrix(
        team({ skills: [s1], assignedUserIds: ["u_1", "u_gone"], levels }),
        [member("u_1")],
        "u_1",
      ),
    );

  expect(
    matrixOf([recorded("u_1", s1, 2), recorded("u_gone", s1, 3, true)]),
  ).toEqual(matrixOf([recorded("u_1", s1, 2)]));
});

it("行はメンバーとセルだけを持ち、人ごとの合計や順位を持たない", () => {
  const s1 = skill(1);

  const { rows } = tableWithAssignedAsMembers({
    skills: [s1],
    assignedUserIds: ["u_1"],
    levels: [recorded("u_1", s1, 3, true)],
  });

  expect(Object.keys(rows[0]).sort()).toEqual(["cells", "member"]);
});

it("未経験 (0) と記入した人と、まだ記入していない人を区別する", () => {
  const s1 = skill(1);

  const { rows } = tableWithAssignedAsMembers({
    skills: [s1],
    assignedUserIds: ["u_1", "u_2"],
    levels: [recorded("u_1", s1, 0)],
  });

  expect(rows.map((row) => row.cells[0].recorded)).toEqual([true, false]);
});

it("メンバー一覧の順で割り当てたメンバーと候補に分け、一覧にいない割り当ては受け取った割り当ての並びのまま事業所にいない人として分ける", () => {
  const { roster } = teamSkillMatrix(
    team({ assignedUserIds: ["u_gone_b", "u_3", "u_gone_a", "u_1"] }),
    [member("u_1"), member("u_2"), member("u_3"), member("u_4")],
    "u_1",
  );

  if (roster._tag === "MembersUnavailable") throw new Error(roster._tag);
  expect(roster.assigned.map((m) => m.userId)).toEqual(["u_1", "u_3"]);
  expect(roster.candidates.map((m) => m.userId)).toEqual(["u_2", "u_4"]);
  expect(roster.departedUserIds).toEqual(["u_gone_b", "u_gone_a"]);
});

it("割り当てられた人の自分のセルは、表のその人の行のセルと同じ", () => {
  const [s1, s2] = [skill(1), skill(2)];

  const matrix = teamSkillMatrix(
    team({
      skills: [s1, s2],
      assignedUserIds: ["u_1", "u_2"],
      levels: [recorded("u_1", s1, 2, true), recorded("u_2", s2, 3)],
    }),
    [member("u_1"), member("u_2")],
    "u_2",
  );

  const myRow = tableOf(matrix).rows.find((row) => row.member.userId === "u_2");
  expect(matrix.myCells).toEqual(myRow?.cells);
});

it.each([
  [
    "割り当てられていない人",
    team({ skills: [skill(1)], assignedUserIds: ["u_1"] }),
    "u_admin",
  ],
  [
    "スキルの無いチームに割り当てられた人",
    team({ assignedUserIds: ["u_1"] }),
    "u_1",
  ],
])("%sには自分のセルが無い", (_, someTeam, userId) => {
  const { myCells } = teamSkillMatrix(
    someTeam,
    [member("u_1"), member("u_admin")],
    userId,
  );

  expect(myCells).toEqual([]);
});

it("メンバー一覧が取れなくても、割り当てられた人の自分のセルは一覧がある時と同じ", () => {
  const s1 = skill(1);
  const assignedTeam = team({
    skills: [s1],
    assignedUserIds: ["u_1"],
    levels: [recorded("u_1", s1, 2, true)],
  });

  const unavailable = teamSkillMatrix(assignedTeam, null, "u_1");

  expect(unavailable.roster).toEqual({ _tag: "MembersUnavailable" });
  expect(unavailable.myCells).toHaveLength(1);
  expect(unavailable.myCells).toEqual(
    teamSkillMatrix(assignedTeam, [member("u_1")], "u_1").myCells,
  );
});

it.each([
  ["スキルが無い", team({ assignedUserIds: ["u_1"] })],
  ["割り当てが無い", team({ skills: [skill(1)] })],
  [
    "割り当てた人が全員事業所にいない",
    team({ skills: [skill(1)], assignedUserIds: ["u_gone"] }),
  ],
])("%s時は星取表が無い", (_, emptyTeam) => {
  const { roster } = teamSkillMatrix(emptyTeam, [member("u_1")], "u_1");

  expect(roster._tag).toBe("MatrixIncomplete");
});

it("スキル 1 つと事業所にいる割り当てたメンバー 1 人がそろえば、1 行の星取表が出る", () => {
  const { rows } = tableWithAssignedAsMembers({
    skills: [skill(1)],
    assignedUserIds: ["u_1"],
  });

  expect(rows).toHaveLength(1);
});
