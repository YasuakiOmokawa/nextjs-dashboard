import { Schema } from "effect";
import { LEVELS } from "@/db/drizzle/schema";

export const Level = Schema.Literals(LEVELS);

// NumberFromString は "" を 0 にするので、先に文字列の値を限る
export const LevelFromForm = Schema.Literals(["0", "1", "2", "3"]).pipe(
  Schema.decodeTo(Schema.NumberFromString.pipe(Schema.decodeTo(Level))),
);

export type Level = typeof Level.Type;
