import { Context } from "effect";
import type { CompanyId } from "@/db/company-id";

// companyId は呼び手から受けず session から導出する (docs/adr/0002-company-data-scoping.md の D2)
/** @effect-leakable-service */
export class CompanyContext extends Context.Service<
  CompanyContext,
  { readonly companyId: CompanyId }
>()("taimei/src/services/CompanyContext") {}
