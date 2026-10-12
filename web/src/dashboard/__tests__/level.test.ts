import { expect, it } from "vitest";
import type { SkillId } from "../../../../db/ids";
import {
  levelEntriesOf,
  levelFieldName,
  levelFromFormValue,
  levels,
  wantsToLearnFieldName,
} from "../level";
import type { Cell } from "../skill-matrix";

it("記号は未経験が空欄、△・○・◎ の順", () => {
  expect(Object.values(levels).map(({ symbol }) => symbol)).toEqual([
    "",
    "△",
    "○",
    "◎",
  ]);
});

it("select の値の 0〜3 だけをレベルにする", () => {
  expect(["0", "1", "2", "3"].map(levelFromFormValue)).toEqual([0, 1, 2, 3]);
  expect(["4", "-1", "", "a", null].map(levelFromFormValue)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

const cellOf = (n: number, recorded: boolean): Cell => ({
  skill: { id: `s${n}` as SkillId, name: `スキル${n}` },
  level: 0,
  wantsToLearn: false,
  recorded,
});

const formWith = (fields: readonly [string, string][]) => {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  return form;
};

it("選んだレベルと学びたいを、スキルの順に保存の entry にする", () => {
  const cells = [cellOf(1, true), cellOf(2, false)];

  const entries = levelEntriesOf(
    cells,
    formWith([
      [levelFieldName("s1"), "3"],
      [wantsToLearnFieldName("s1"), "on"],
      [levelFieldName("s2"), "0"],
    ]),
  );

  expect(entries).toEqual([
    { skillId: "s1", level: 3, wantsToLearn: true },
    { skillId: "s2", level: 0, wantsToLearn: false },
  ]);
});

it("未記入のまま学びたいも付けないスキルは送らず、未記入のままにする", () => {
  const entries = levelEntriesOf(
    [cellOf(1, false)],
    formWith([[levelFieldName("s1"), ""]]),
  );

  expect(entries).toEqual([]);
});

it("未記入のまま学びたいを付けたスキルは、未経験で学びたいとして送る", () => {
  const entries = levelEntriesOf(
    [cellOf(1, false)],
    formWith([
      [levelFieldName("s1"), ""],
      [wantsToLearnFieldName("s1"), "on"],
    ]),
  );

  expect(entries).toEqual([{ skillId: "s1", level: 0, wantsToLearn: true }]);
});
