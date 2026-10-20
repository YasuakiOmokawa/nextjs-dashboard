import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

// 1 DO = 1 事業所なので company_id の列を持たない。CASCADE は表の作り直しで子の行を消すので付けない (poc.md の M2)
export const teams = sqliteTable("teams", {
  id: text().primaryKey(),
  name: text().notNull(),
});

export const skills = sqliteTable(
  "skills",
  {
    id: text().primaryKey(),
    teamId: text("team_id").notNull(),
    name: text().notNull(),
  },
  (t) => [
    unique().on(t.teamId, t.name),
    foreignKey({ columns: [t.teamId], foreignColumns: [teams.id] }),
  ],
);

export const teamAssignments = sqliteTable(
  "team_assignments",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    foreignKey({ columns: [t.teamId], foreignColumns: [teams.id] }),
  ],
);

export const memberSkills = sqliteTable(
  "member_skills",
  {
    teamId: text("team_id").notNull(),
    skillId: text("skill_id").notNull(),
    userId: text("user_id").notNull(),
    level: integer().notNull(),
    wantsToLearn: integer("wants_to_learn", { mode: "boolean" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skillId, t.userId] }),
    index("member_skills_team_id_user_id_idx").on(t.teamId, t.userId),
    check("member_skills_level_range", sql`${t.level} BETWEEN 0 AND 3`),
    foreignKey({ columns: [t.skillId], foreignColumns: [skills.id] }),
    foreignKey({
      columns: [t.teamId, t.userId],
      foreignColumns: [teamAssignments.teamId, teamAssignments.userId],
    }),
  ],
);
