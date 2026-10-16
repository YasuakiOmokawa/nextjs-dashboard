import { COMPANY_ID_PATTERN } from "@taimei-code/auth-client";
import { Schema } from "effect";

export const CompanyId = Schema.String.check(
  Schema.isPattern(COMPANY_ID_PATTERN),
).pipe(Schema.brand("CompanyId"));
export type CompanyId = typeof CompanyId.Type;
