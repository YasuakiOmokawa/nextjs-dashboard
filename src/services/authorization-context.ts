import type { Role } from "@taimei-code/auth-client";
import { Context } from "effect";

// CompanyContext と分ける理由は docs/adr/0002-company-data-scoping.md の D2
/** @effect-leakable-service */
export class AuthorizationContext extends Context.Service<
  AuthorizationContext,
  { readonly userId: string; readonly role: Role | undefined }
>()("taimei/src/services/AuthorizationContext") {}

// undefined は SDK の約束で権限なし
export const isManager = (role: Role | undefined) =>
  role === "OWNER" || role === "ADMIN";
