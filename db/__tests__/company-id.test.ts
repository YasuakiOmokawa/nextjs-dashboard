import { COMPANY_ID_PATTERN } from "@taimei-code/auth-client";
import { sql } from "drizzle-orm";
import { Schema } from "effect";
import { expect, it } from "vitest";
import { fixtureCompanyId } from "@/src/services/__tests__/db/seed";
import { withRollback } from "@/src/services/__tests__/db/test-db";
import { CompanyId } from "../company-id";

const isCompanyId = Schema.is(CompanyId);
const companyId = fixtureCompanyId("a");

it.each([
  ["SDK の形で作った id", companyId],
  ["1 文字短い id", companyId.slice(0, -1)],
  ["1 文字長い id", `${companyId}a`],
  ["空の文字列", ""],
  ["別の形の id", "u_1"],
])(
  "CompanyId は %s を SDK の事業所 id の形と同じに判定する (形を taimei に書かない)",
  (_, value) => {
    expect(isCompanyId(value)).toBe(COMPANY_ID_PATTERN.test(value));
  },
);

it("fixtureCompanyId は同じ label に同じ id を返し、違う label に違う id を返す", () => {
  expect(fixtureCompanyId("a")).toBe(companyId);
  expect(fixtureCompanyId("b")).not.toBe(companyId);
});

it("company_id の列はどの表も、SDK の事業所 id の形で作った id を切り詰めずに収める", () =>
  withRollback(async (tx) => {
    const { rows } = await tx.execute<{
      table_name: string;
      character_maximum_length: number | null;
    }>(
      sql`select table_name, character_maximum_length from information_schema.columns where table_schema = 'public' and column_name = 'company_id'`,
    );
    const companyIds = Array.from({ length: 100 }, (_, i) =>
      fixtureCompanyId(`column-length-${i}`),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.filter(({ character_maximum_length: maxLength }) =>
        companyIds.some((id) => maxLength !== null && id.length > maxLength),
      ),
    ).toEqual([]);
  }));
