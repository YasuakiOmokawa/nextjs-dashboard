import { eq } from "drizzle-orm";
import {
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import { CompanyId, type SkillId, type TeamId } from "@/db/ids";
import type { Level } from "../../level";
import type { TestDb } from "./test-db";

export const createdAtMinute = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute));

export const seedTeam = async (
  tx: TestDb,
  companyId: string,
  name: string,
  createdAt?: Date,
) => {
  const [row] = await tx
    .insert(teams)
    .values({ companyId: CompanyId.make(companyId), name, createdAt })
    .returning({ id: teams.id });
  return row.id;
};

export const seedSkill = async (
  tx: TestDb,
  companyId: string,
  teamId: TeamId,
  name: string,
  createdAt?: Date,
) => {
  const [row] = await tx
    .insert(skills)
    .values({ companyId: CompanyId.make(companyId), teamId, name, createdAt })
    .returning({ id: skills.id });
  return row.id;
};

export const seedAssignment = (
  tx: TestDb,
  companyId: string,
  teamId: TeamId,
  userId: string,
) =>
  tx
    .insert(teamAssignments)
    .values({ companyId: CompanyId.make(companyId), teamId, userId });

export const seedLevel = (
  tx: TestDb,
  {
    level = 1,
    wantsToLearn = false,
    ...row
  }: {
    companyId: string;
    teamId: TeamId;
    skillId: SkillId;
    userId: string;
    level?: Level;
    wantsToLearn?: boolean;
  },
) =>
  tx.insert(memberSkills).values({
    ...row,
    level,
    wantsToLearn,
    companyId: CompanyId.make(row.companyId),
  });

export const teamName = async (tx: TestDb, id: TeamId) => {
  const [row] = await tx
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, id));
  return row?.name;
};
