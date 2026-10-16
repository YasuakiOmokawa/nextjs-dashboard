import { Schema } from "effect";

const Uuid = Schema.String.check(Schema.isUUID());

export const TeamId = Uuid.pipe(Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;

export const SkillId = Uuid.pipe(Schema.brand("SkillId"));
export type SkillId = typeof SkillId.Type;
