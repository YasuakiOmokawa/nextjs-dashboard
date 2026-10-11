import { Exit, Schema } from "effect";
import { expect, it } from "vitest";
import { LEVELS } from "@/db/drizzle/schema";
import { LevelFromForm } from "../level";

const decode = Schema.decodeUnknownExit(LevelFromForm);

it("フォームの文字列を、DB と同じ範囲 (LEVELS) の数のレベルにする", () => {
  expect(LEVELS.map((level) => decode(String(level)))).toEqual(
    LEVELS.map((level) => Exit.succeed(level)),
  );
  expect(Exit.isFailure(decode(String(Math.max(...LEVELS) + 1)))).toBe(true);
});

it("0〜3 でない値はレベルにならない", () => {
  for (const value of ["4", "-1", "a", ""])
    expect(Exit.isFailure(decode(value))).toBe(true);
});
