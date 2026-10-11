import { expect, it } from "vitest";
import { levels } from "../level";

it("記号は未経験が空欄、△・○・◎ の順", () => {
  expect(Object.values(levels).map(({ symbol }) => symbol)).toEqual([
    "",
    "△",
    "○",
    "◎",
  ]);
});
