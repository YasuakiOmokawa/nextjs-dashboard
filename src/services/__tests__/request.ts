import type { Role } from "@taimei-code/auth-client";
import { Effect, Result } from "effect";
import { CompanyId } from "@/db/ids";
import { AuthorizationContext } from "../authorization-context";
import { CompanyContext } from "../company-context";

export type Actor = {
  companyId: string;
  userId: string;
  role: Role | undefined;
};

export const ADMIN: Actor = {
  companyId: "cmp_a",
  userId: "u_admin",
  role: "ADMIN",
};
export const MEMBER: Actor = {
  companyId: "cmp_a",
  userId: "u_m",
  role: "MEMBER",
};
export const NO_ROLE: Actor = {
  companyId: "cmp_a",
  userId: "u_m",
  role: undefined,
};

export const failureTag = <A, E extends { _tag: string }>(
  result: Result.Result<A, E>,
) => (Result.isFailure(result) ? result.failure._tag : "success");

export const runAsActor = <A, E>(
  actor: Actor,
  effect: Effect.Effect<A, E, CompanyContext | AuthorizationContext>,
) =>
  Effect.runPromise(
    Effect.result(
      effect.pipe(
        Effect.provideService(CompanyContext, {
          companyId: CompanyId.make(actor.companyId),
        }),
        Effect.provideService(AuthorizationContext, {
          userId: actor.userId,
          role: actor.role,
        }),
      ),
    ),
  );
