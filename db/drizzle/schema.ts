import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  type PgColumn,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { LEVELS, NAME_MAX_LENGTH } from "../column-values";
import type { CompanyId } from "../company-id";
import type { SkillId, TeamId } from "../ids";

const companyId = () => text("company_id").notNull().$type<CompanyId>();
export const COMPANY_ID_SETTING = "app.company_id";
export const MEMBER_SKILLS_ASSIGNMENT_FK = "member_skills_assignment_fk";
export const MEMBER_SKILLS_SKILL_FK = "member_skills_skill_fk";
export const TEAMS_NAME_UNIQUE = "teams_company_id_name_unique";
export const SKILLS_NAME_UNIQUE = "skills_team_id_name_unique";
export const SKILLS_TEAM_FK =
  "skills_team_id_company_id_teams_id_company_id_fk";
export const TEAM_ASSIGNMENTS_TEAM_FK =
  "team_assignments_team_id_company_id_teams_id_company_id_fk";

// docs/adr/0005
const companyIsolation = (table: { companyId: PgColumn }) => {
  const sameCompany = sql`${table.companyId} = current_setting(${sql.raw(`'${COMPANY_ID_SETTING}'`)}, true)`;
  return pgPolicy("company_isolation", {
    for: "all",
    using: sameCompany,
    withCheck: sameCompany,
  });
};
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const teams = pgTable(
  "teams",
  {
    id: uuid().defaultRandom().primaryKey().$type<TeamId>(),
    companyId: companyId(),
    name: varchar({ length: NAME_MAX_LENGTH }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique().on(table.id, table.companyId),
    unique(TEAMS_NAME_UNIQUE).on(table.companyId, table.name),
    companyIsolation(table),
  ],
);

export const companyTeamListVersions = pgTable(
  "company_team_list_versions",
  {
    companyId: companyId().primaryKey(),
    version: bigint({ mode: "number" }).notNull(),
  },
  (table) => [companyIsolation(table)],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid().defaultRandom().primaryKey().$type<SkillId>(),
    companyId: companyId(),
    teamId: uuid("team_id").notNull().$type<TeamId>(),
    name: varchar({ length: NAME_MAX_LENGTH }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique(SKILLS_NAME_UNIQUE).on(table.teamId, table.name),
    unique().on(table.id, table.teamId, table.companyId),
    companyIsolation(table),
    foreignKey({
      name: SKILLS_TEAM_FK,
      columns: [table.teamId, table.companyId],
      foreignColumns: [teams.id, teams.companyId],
    }).onDelete("cascade"),
  ],
);

export const teamAssignments = pgTable(
  "team_assignments",
  {
    companyId: companyId(),
    teamId: uuid("team_id").notNull().$type<TeamId>(),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    companyIsolation(table),
    foreignKey({
      name: TEAM_ASSIGNMENTS_TEAM_FK,
      columns: [table.teamId, table.companyId],
      foreignColumns: [teams.id, teams.companyId],
    }).onDelete("cascade"),
  ],
);

export const memberSkills = pgTable(
  "member_skills",
  {
    companyId: companyId(),
    teamId: uuid("team_id").notNull().$type<TeamId>(),
    skillId: uuid("skill_id").notNull().$type<SkillId>(),
    userId: text("user_id").notNull(),
    level: smallint().$type<(typeof LEVELS)[number]>().notNull(),
    wantsToLearn: boolean("wants_to_learn").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.userId] }),
    index("member_skills_team_id_user_id_idx").on(table.teamId, table.userId),
    check("member_skills_level_range", sql`${table.level} BETWEEN 0 AND 3`),
    companyIsolation(table),
    // drizzle-kit の既定の名前は PostgreSQL の識別子の上限 (63 バイト) を超える
    foreignKey({
      name: MEMBER_SKILLS_ASSIGNMENT_FK,
      columns: [table.teamId, table.userId],
      foreignColumns: [teamAssignments.teamId, teamAssignments.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: MEMBER_SKILLS_SKILL_FK,
      columns: [table.skillId, table.teamId, table.companyId],
      foreignColumns: [skills.id, skills.teamId, skills.companyId],
    }).onDelete("cascade"),
  ],
);
