import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// 今の Postgres の FK を SQLite に写したもの。M2_ON_DELETE で CASCADE の有無、M2_STEP=2 で親の teams に CHECK を足す
const cascade = process.env.M2_ON_DELETE === "cascade";
const step2 = process.env.M2_STEP === "2";
const onDelete = <T extends { onDelete: (a: "cascade") => T }>(fk: T) =>
  cascade ? fk.onDelete("cascade") : fk;

export const teams = sqliteTable(
  "teams",
  { id: text().primaryKey(), name: text().notNull() },
  (t) => (step2 ? [check("teams_name_length", sql`length(${t.name}) <= 50`)] : []),
);

export const skills = sqliteTable(
  "skills",
  { id: text().primaryKey(), teamId: text("team_id").notNull(), name: text().notNull() },
  (t) => [onDelete(foreignKey({ columns: [t.teamId], foreignColumns: [teams.id] }))],
);

export const teamAssignments = sqliteTable(
  "team_assignments",
  { teamId: text("team_id").notNull(), userId: text("user_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    onDelete(foreignKey({ columns: [t.teamId], foreignColumns: [teams.id] })),
  ],
);

export const memberSkills = sqliteTable(
  "member_skills",
  {
    teamId: text("team_id").notNull(),
    skillId: text("skill_id").notNull(),
    userId: text("user_id").notNull(),
    level: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skillId, t.userId] }),
    onDelete(foreignKey({ columns: [t.skillId], foreignColumns: [skills.id] })),
    onDelete(
      foreignKey({
        columns: [t.teamId, t.userId],
        foreignColumns: [teamAssignments.teamId, teamAssignments.userId],
      }),
    ),
  ],
);
