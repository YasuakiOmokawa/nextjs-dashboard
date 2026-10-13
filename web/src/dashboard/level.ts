import type { Level } from "../../../src/spa-contract";
import type { Cell, MyLevelEntry } from "./skill-matrix";

export const levels: Record<Level, { symbol: string; label: string }> = {
  0: { symbol: "", label: "未経験" },
  1: { symbol: "△", label: "支援があればできる" },
  2: { symbol: "○", label: "一人でできる" },
  3: { symbol: "◎", label: "教えられる" },
};

export const levelFromFormValue = (value: FormDataEntryValue | null) =>
  typeof value === "string" && Object.hasOwn(levels, value)
    ? (Number(value) as Level)
    : undefined;

export const levelFieldName = (skillId: string) => `level:${skillId}`;
export const wantsToLearnFieldName = (skillId: string) => `wants:${skillId}`;

const UNRECORDED_BUT_WANTS_TO_LEARN = 0;

export const levelEntriesOf = (
  cells: readonly Cell[],
  form: FormData,
): MyLevelEntry[] =>
  cells.flatMap(({ skill }) => {
    const wantsToLearn = form.has(wantsToLearnFieldName(skill.id));
    const level =
      levelFromFormValue(form.get(levelFieldName(skill.id))) ??
      (wantsToLearn ? UNRECORDED_BUT_WANTS_TO_LEARN : undefined);
    return level === undefined
      ? []
      : [{ skillId: skill.id, level, wantsToLearn }];
  });
