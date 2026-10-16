import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { COMPANY_A, COMPANY_B } from "@/src/services/__tests__/db/seed";
import {
  switchToRoleWithoutRlsBypass,
  type TestDb,
  withRollback,
} from "@/src/services/__tests__/db/test-db";
import { CompanyId } from "../company-id";
import {
  memberSkills,
  skills,
  teamAssignments,
  teams,
} from "../drizzle/schema";
import { withCompanyScope } from "../scoped";

const scopedTables = { teams, skills, teamAssignments, memberSkills };

const seedCompany = async (tx: TestDb, companyId: CompanyId) => {
  const [team] = await tx
    .insert(teams)
    .values({ companyId, name: `${companyId} のチーム` })
    .returning();
  const [skill] = await tx
    .insert(skills)
    .values({ companyId, teamId: team.id, name: "設計" })
    .returning();
  await tx
    .insert(teamAssignments)
    .values({ companyId, teamId: team.id, userId: `u_${companyId}` });
  await tx.insert(memberSkills).values({
    companyId,
    teamId: team.id,
    skillId: skill.id,
    userId: `u_${companyId}`,
    level: 2,
    wantsToLearn: false,
  });
  return team;
};

const countRows = async (tx: Pick<TestDb, "select">) => {
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(scopedTables)) {
    const [{ value }] = await tx.select({ value: count() }).from(table);
    counts[name] = value;
  }
  return counts;
};

const oneRowPerTable = {
  teams: 1,
  skills: 1,
  teamAssignments: 1,
  memberSkills: 1,
};
const noRowsPerTable = {
  teams: 0,
  skills: 0,
  teamAssignments: 0,
  memberSkills: 0,
};

it("company_id を持つ表はすべて company_isolation の policy を持つ", () =>
  withRollback(async (tx) => {
    const { rows } = await tx.execute<{
      table_name: string;
      policy: string | null;
    }>(sql`
      select c.table_name, p.policyname as policy
      from information_schema.columns c
      left join pg_policies p
        on p.schemaname = c.table_schema and p.tablename = c.table_name and p.policyname = 'company_isolation'
      where c.table_schema = 'public' and c.column_name = 'company_id'
      order by c.table_name`);

    expect(rows).toEqual(
      [
        "company_team_list_versions",
        "member_skills",
        "skills",
        "team_assignments",
        "teams",
      ].map((table_name) => ({
        table_name,
        policy: "company_isolation",
      })),
    );
  }));

describe("RLS (BYPASSRLS の無い role)", () => {
  it("app.company_id が無いと、4 つの表のどの行も見えない", () =>
    withRollback(async (tx) => {
      await seedCompany(tx, COMPANY_A);
      await seedCompany(tx, COMPANY_B);
      expect(await countRows(tx)).toEqual({
        teams: 2,
        skills: 2,
        teamAssignments: 2,
        memberSkills: 2,
      });

      await switchToRoleWithoutRlsBypass(tx);

      expect(await countRows(tx)).toEqual(noRowsPerTable);
    }));

  it("withCompanyScope の中では、4 つの表でその事業所の行だけが見える", () =>
    withRollback(async (tx) => {
      await seedCompany(tx, COMPANY_A);
      await seedCompany(tx, COMPANY_B);
      await switchToRoleWithoutRlsBypass(tx);

      const seen = await withCompanyScope(tx, COMPANY_A, async (scoped) => ({
        rows: await countRows(scoped),
        companies: await scoped
          .selectDistinct({ companyId: teams.companyId })
          .from(teams),
      }));

      expect(seen).toEqual({
        rows: oneRowPerTable,
        companies: [{ companyId: COMPANY_A }],
      });
    }));

  it("withCompanyScope の中から、他社の行は INSERT できない", () =>
    withRollback(async (tx) => {
      await switchToRoleWithoutRlsBypass(tx);

      const insertOtherCompany = withCompanyScope(tx, COMPANY_A, (scoped) =>
        scoped.insert(teams).values({
          companyId: COMPANY_B,
          name: "他社のチーム",
        }),
      );

      await expect(insertOtherCompany).rejects.toMatchObject({
        cause: { code: "42501" },
      });
    }));

  it("withCompanyScope の中から、他社の行は UPDATE も DELETE もできない", () =>
    withRollback(async (tx) => {
      const other = await seedCompany(tx, COMPANY_B);
      await switchToRoleWithoutRlsBypass(tx);

      const changed = await withCompanyScope(tx, COMPANY_A, async (scoped) => ({
        updated: await scoped
          .update(teams)
          .set({ name: "書き換え" })
          .where(eq(teams.id, other.id))
          .returning(),
        deleted: await scoped
          .delete(teams)
          .where(eq(teams.id, other.id))
          .returning(),
      }));
      await tx.execute(sql`RESET ROLE`);

      expect(changed).toEqual({ updated: [], deleted: [] });
      expect(await tx.select().from(teams)).toEqual([other]);
    }));

  it("withCompanyScope の中から自社のチームを消すと、スキル・割り当て・評価も消える", () =>
    withRollback(async (tx) => {
      const own = await seedCompany(tx, COMPANY_A);
      expect(await countRows(tx)).toEqual(oneRowPerTable);
      await switchToRoleWithoutRlsBypass(tx);

      const deleted = await withCompanyScope(tx, COMPANY_A, (scoped) =>
        scoped.delete(teams).where(eq(teams.id, own.id)).returning(),
      );
      await tx.execute(sql`RESET ROLE`);

      expect(deleted).toHaveLength(1);
      expect(await countRows(tx)).toEqual(noRowsPerTable);
    }));

  it("company_ids_with_teams() は、どの事業所も設定しないまま全事業所の id を返す", () =>
    withRollback(async (tx) => {
      await seedCompany(tx, COMPANY_A);
      await seedCompany(tx, COMPANY_B);
      await switchToRoleWithoutRlsBypass(tx);
      expect(await countRows(tx)).toEqual(noRowsPerTable);

      const { rows } = await tx.execute<{ company_id: string }>(
        sql`select company_id from company_ids_with_teams() as company_id`,
      );

      expect(rows.map((row) => row.company_id).sort()).toEqual(
        [COMPANY_A, COMPANY_B].sort(),
      );
    }));
});
