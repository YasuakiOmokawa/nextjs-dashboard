import { execFileSync } from "node:child_process";
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

it("company_id の列はどの表も長さの上限を持たない text にする (事業所 id の長さは SDK の COMPANY_ID_PATTERN が決める)", () =>
  withRollback(async (tx) => {
    const { rows } = await tx.execute<{
      table_name: string;
      data_type: string;
    }>(
      sql`select table_name, data_type from information_schema.columns where table_schema = 'public' and column_name = 'company_id'`,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter(({ data_type }) => data_type !== "text")).toEqual([]);
  }));

it("テストの外で CompanyId を作るのは、session を確かめる requestSessionOf と DB の行を読む purgeDeparted だけ (ほかの値は session か DB から受け取る)", () => {
  const constructors = execFileSync(
    "git",
    [
      "grep",
      "--untracked",
      "-l",
      "-E",
      "CompanyId\\.make|\\(CompanyId\\)",
      "--",
      "src",
      "db",
      "web/src",
      ":!**/__tests__/**",
      ":!*.md",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");

  expect(constructors).toEqual(["src/auth.ts", "src/lib/purge-departed.ts"]);
});
