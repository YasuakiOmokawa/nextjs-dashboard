import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/drizzle/schema";
import { TEST_DATABASE_URL } from "@/src/services/__tests__/db/global-setup";
import { seedTeam } from "@/src/services/__tests__/db/seed";
import {
  currentCompanySetting,
  switchToRoleWithoutRlsBypass,
  type TestDb,
  withRollback,
} from "@/src/services/__tests__/db/test-db";

const EXPLICIT_COMPANY_FILTER = /\b\w+\.company_id = p_company_id\b/g;

const replaceWithRlsOnlyVersion = async (tx: TestDb, name: string) => {
  const { rows } = await tx.execute<{ definition: string }>(
    sql`select pg_get_functiondef(${name}::regproc) as definition`,
  );
  const definition = rows[0].definition;
  const filters = definition.match(EXPLICIT_COMPANY_FILTER) ?? [];
  await tx.execute(
    sql.raw(definition.replace(EXPLICIT_COMPANY_FILTER, "TRUE")),
  );
  return filters.length;
};

describe("明示の絞り込みを外しても、RLS だけで他社が見えない", () => {
  it("team_matrix は他社のチームを null にし、自社のチームを返す", () =>
    withRollback(async (tx) => {
      const own = await seedTeam(tx, "cmp_a", "A のチーム");
      const other = await seedTeam(tx, "cmp_b", "B のチーム");
      expect(
        await replaceWithRlsOnlyVersion(tx, "team_matrix"),
      ).toBeGreaterThan(0);
      expect(
        await replaceWithRlsOnlyVersion(tx, "team_visible_to"),
      ).toBeGreaterThan(0);
      await switchToRoleWithoutRlsBypass(tx);

      const matrixOf = async (teamId: string) => {
        const { rows } = await tx.execute<{ team: unknown }>(
          sql`select team_matrix('cmp_a', ${teamId}, 'u_1', true) as team`,
        );
        return rows[0].team;
      };

      expect(await matrixOf(other)).toBeNull();
      expect(await matrixOf(own)).not.toBeNull();
    }));

  it("team_list は自社のチームだけを返す", () =>
    withRollback(async (tx) => {
      const own = await seedTeam(tx, "cmp_a", "A のチーム");
      const other = await seedTeam(tx, "cmp_b", "B のチーム");
      expect(await replaceWithRlsOnlyVersion(tx, "team_list")).toBeGreaterThan(
        0,
      );
      expect(
        await replaceWithRlsOnlyVersion(tx, "team_visible_to"),
      ).toBeGreaterThan(0);
      await switchToRoleWithoutRlsBypass(tx);

      const { rows } = await tx.execute<{ teams: { id: string }[] }>(
        sql`select team_list('cmp_a', 'u_1', true) as teams`,
      );

      const ids = rows[0].teams.map((team) => team.id);
      expect(ids).toContain(own);
      expect(ids).not.toContain(other);
    }));
});

describe("関数の set_config は、同じ接続の次の文に漏れない", () => {
  // withRollback の中では外側の transaction の終わりまで設定が残るので、transaction の外の接続で見る
  const companySettingAfter = async (call: string) => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(call);
      return await currentCompanySetting(drizzle(client, { schema }));
    } finally {
      await client.end();
    }
  };

  it.each([
    [
      "team_matrix",
      `select team_matrix('cmp_a', '${crypto.randomUUID()}', 'u_1', true)`,
    ],
    ["team_list", "select team_list('cmp_a', 'u_1', true)"],
  ])("%s", async (_, call) => {
    expect(await companySettingAfter(call)).toBeFalsy();
  });
});
