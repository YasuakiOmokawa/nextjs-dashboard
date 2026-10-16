import { COMPANY_ID_PATTERN } from "@taimei-code/auth-client";
import { Schema } from "effect";
import { expect, it } from "vitest";
import { fixtureCompanyId } from "@/src/services/__tests__/db/seed";
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
