import type { Role } from "@taimei-code/auth-client";
import { Context } from "effect";

// CompanyContext と分ける理由は docs/adr/0002-company-data-scoping.md の D2
/** @effect-leakable-service */
export class AuthorizationContext extends Context.Service<
  AuthorizationContext,
  { readonly userId: string; readonly role: Role | undefined }
>()("taimei/src/services/AuthorizationContext") {}

const CAN_MANAGE_BY_ROLE: Record<Role, boolean> = {
  OWNER: true,
  ADMIN: true,
  MEMBER: false,
};

export const isManager = (role: Role | undefined) =>
  role !== undefined && CAN_MANAGE_BY_ROLE[role];
