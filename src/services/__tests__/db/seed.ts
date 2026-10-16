import { eq } from "drizzle-orm";
import { Arbitrary, Effect } from "effect";
import { CompanyId } from "@/db/company-id";
import {
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "@/db/drizzle/schema";
import type { SkillId, TeamId } from "@/db/ids";
import type { Level } from "@/src/spa-contract";
import type { TestDb } from "./test-db";

const companyIdArbitrary = Arbitrary.schema(CompanyId);

export const fixtureCompanyId = (label: string): CompanyId => {
  const [companyId] = Effect.runSync(
    Arbitrary.sampleEffect(companyIdArbitrary, { count: 1, seed: label }),
  );
  return companyId;
};

export const COMPANY_A = fixtureCompanyId("a");
export const COMPANY_B = fixtureCompanyId("b");

export const createdAtMinute = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute));

export const seedTeam = async (
  tx: TestDb,
  companyId: CompanyId,
  name: string,
  createdAt?: Date,
) => {
  const [row] = await tx
    .insert(teams)
    .values({ companyId, name, createdAt })
    .returning({ id: teams.id });
  return row.id;
};

export const seedSkill = async (
  tx: TestDb,
  companyId: CompanyId,
  teamId: TeamId,
  name: string,
  createdAt?: Date,
) => {
  const [row] = await tx
    .insert(skills)
    .values({ companyId, teamId, name, createdAt })
    .returning({ id: skills.id });
  return row.id;
};

export const seedAssignment = (
  tx: TestDb,
  companyId: CompanyId,
  teamId: TeamId,
  userId: string,
) => tx.insert(teamAssignments).values({ companyId, teamId, userId });

export const seedLevel = (
  tx: TestDb,
  {
    level = 1,
    wantsToLearn = false,
    ...row
  }: {
    companyId: CompanyId;
    teamId: TeamId;
    skillId: SkillId;
    userId: string;
    level?: Level;
    wantsToLearn?: boolean;
  },
) => tx.insert(memberSkills).values({ ...row, level, wantsToLearn });

export const teamName = async (tx: TestDb, id: TeamId) => {
  const [row] = await tx
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, id));
  return row?.name;
};
