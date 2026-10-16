import type { Role } from "@taimei-code/auth-client";
import { Effect, Result } from "effect";
import { onTestFinished, vi } from "vitest";
import type { CompanyId } from "@/db/company-id";
import { sendErrorReportsTo } from "@/src/lib/report-error";
import { AuthorizationContext } from "../authorization-context";
import { CompanyContext } from "../company-context";
import { CompanyTeamList } from "../company-team-list";
import { TeamListStore, type TeamListStub } from "../team-list-store";
import { COMPANY_A } from "./db/seed";
import { sqliteStorage } from "./sqlite-storage";

export type Actor = {
  companyId: CompanyId;
  userId: string;
  role: Role | undefined;
};

export const ADMIN: Actor = {
  companyId: COMPANY_A,
  userId: "u_admin",
  role: "ADMIN",
};
export const MEMBER: Actor = {
  companyId: COMPANY_A,
  userId: "u_m",
  role: "MEMBER",
};
export const NO_ROLE: Actor = {
  companyId: COMPANY_A,
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
          companyId: actor.companyId,
        }),
        Effect.provideService(AuthorizationContext, {
          userId: actor.userId,
          role: actor.role,
        }),
      ),
    ),
  );

export const emptyTeamListStore = () => new TeamListStore(sqliteStorage());

export const teamListStubOf = (
  store: TeamListStore = emptyTeamListStore(),
) => ({
  read: vi.fn<TeamListStub["read"]>((workerVersion) =>
    store.read(workerVersion),
  ),
  replace: vi.fn<TeamListStub["replace"]>((workerVersion, snapshot) =>
    store.replace(workerVersion, snapshot),
  ),
  clear: vi.fn(() => store.clear()),
});
export type TeamListStubSpy = ReturnType<typeof teamListStubOf>;

export const readReplaceClearCounts = (stub: TeamListStubSpy) => [
  stub.read.mock.calls.length,
  stub.replace.mock.calls.length,
  stub.clear.mock.calls.length,
];

export const WORKER_VERSION = "v1";

export const companyTeamListBackedBy =
  (stub: TeamListStub = emptyTeamListStore()) =>
  () =>
    CompanyTeamList.fromStub(() => stub, WORKER_VERSION);

export const captureReports = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const send = vi.fn();
  sendErrorReportsTo(send);
  onTestFinished(() => {
    sendErrorReportsTo(() => {});
    vi.restoreAllMocks();
  });
  return send;
};
