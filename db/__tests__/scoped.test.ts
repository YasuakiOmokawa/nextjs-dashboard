import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "@/src/services/__tests__/db/global-setup";
import { COMPANY_A, fixtureCompanyId } from "@/src/services/__tests__/db/seed";
import {
  currentCompanySetting,
  withRollback,
} from "@/src/services/__tests__/db/test-db";
import * as schema from "../drizzle/schema";
import { companyFilter, withCompanyScope } from "../scoped";

const COMPANY_X = fixtureCompanyId("x");

const scopedRows = pgTable("scoped_rows", {
  companyId: text("company_id").notNull(),
});

it("companyFilter は company_id が渡した事業所と一致する行に絞る", () => {
  expect(
    new PgDialect().sqlToQuery(companyFilter(scopedRows, COMPANY_A)),
  ).toMatchObject({
    sql: '"scoped_rows"."company_id" = $1',
    params: [COMPANY_A],
  });
});

it("withCompanyScope の中では、渡した事業所が app.company_id に入っている", () =>
  withRollback(async (tx) => {
    const seen = await withCompanyScope(tx, COMPANY_X, currentCompanySetting);
    expect(seen).toBe(COMPANY_X);
  }));

it("withCompanyScope を抜けると、同じ接続の app.company_id は渡した事業所でなくなる", async () => {
  // savepoint では set_config の local が外側の transaction まで残るので、1 本の接続で top-level の transaction を使う
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const db = drizzle(client, { schema });
    await withCompanyScope(db, COMPANY_X, async (scoped) => {
      expect(await currentCompanySetting(scoped)).toBe(COMPANY_X);
    });
    expect(await currentCompanySetting(db)).not.toBe(COMPANY_X);
  } finally {
    await client.end();
  }
});

it("withCompanyScope の fn が throw すると、fn の中の書き込みは残らない", () =>
  withRollback(async (tx) => {
    const failure = new Error("fn failed");
    await expect(
      withCompanyScope(tx, COMPANY_X, async (scoped) => {
        const inserted = await scoped
          .insert(schema.teams)
          .values({ companyId: COMPANY_X, name: "消えるチーム" })
          .returning();
        expect(inserted).toHaveLength(1);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await tx.select().from(schema.teams)).toEqual([]);
  }));
