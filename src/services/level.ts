import { Schema } from "effect";
import { LEVELS } from "@/db/drizzle/schema";

export const Level = Schema.Literals(LEVELS);

export type Level = typeof Level.Type;
