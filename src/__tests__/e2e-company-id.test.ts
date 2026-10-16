import { COMPANY_ID_PATTERN } from "@taimei-code/auth-client";
import { expect, it } from "vitest";
import { uniqueCompanyId } from "../../e2e/tests/utils/company-id";

it.each(["a", "e2e", "qa"])(
  "e2e と qa:serve が taimei-auth の DB に入れる事業所 id (prefix %s) は SDK の事業所 id の形に合う (合わないと app の CompanyId が投げる)",
  (prefix) => {
    expect(uniqueCompanyId(prefix)).toMatch(COMPANY_ID_PATTERN);
  },
);
