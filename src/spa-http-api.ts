import type { Member } from "@taimei-code/auth-client";
import { Context, Effect, ErrorReporter, Layer, Match, Result } from "effect";
// biome-ignore lint/style/noRestrictedImports: 契約を Hono に載せる file だけが web handler を組む (ADR-0007)
import { HttpRouter, HttpServer } from "effect/http";
import {
  HttpApiBuilder,
  type HttpApiEndpoint,
  HttpApiError,
  type HttpApiGroup,
} from "effect/http-api";
import { reportError } from "@/src/lib/report-error";
import {
  runServiceWithoutDb,
  runTeamManagement,
  runTeamReads,
  runTeamService,
} from "@/src/services";
import { isManager } from "@/src/services/authorization-context";
import type { CompanyContext } from "@/src/services/company-context";
import { CompanyMembers } from "@/src/services/company-members-service";
import {
  defectOf,
  isUnexpectedFailure,
  type TeamFailure,
  type UnexpectedFailure,
} from "@/src/services/failures";
import type { RequestSession } from "@/src/services/request-session";
import type { TeamManagement } from "@/src/services/team-management";
import {
  Authenticated,
  CurrentSession,
  type MeGroup,
  type MembersGroup,
  type SessionChanged,
  SpaApi,
  type TeamsGroup,
  Unauthenticated,
} from "@/src/spa-contract";

export type SessionCheck = Result.Result<
  RequestSession,
  Unauthenticated | SessionChanged
>;

// middleware の要求は layer を組む時にしか満たせないので、要求ごとの値は Reference で渡す
const SessionCheckRef = Context.Reference<SessionCheck>("taimei/SessionCheck", {
  defaultValue: () => Result.fail(new Unauthenticated()),
});

const AuthenticatedLive = Layer.succeed(Authenticated, (httpEffect) =>
  Effect.gen(function* () {
    const session = yield* Effect.fromResult(yield* SessionCheckRef);
    return yield* Effect.provideService(httpEffect, CurrentSession, session);
  }),
);

export type DecodedHandlers<Group> = {
  readonly [E in HttpApiGroup.Endpoints<Group> as HttpApiEndpoint.Identifier<E>]: (
    input: Omit<HttpApiEndpoint.Request<E>, "request" | "endpoint" | "group">,
  ) => Effect.Effect<
    HttpApiEndpoint.Success<E>["Type"],
    HttpApiEndpoint.Error<E>["Type"] | HttpApiEndpoint.MiddlewareError<E>,
    CurrentSession
  >;
};

const runServiceForCurrentSession = <A, E extends TeamFailure>(
  run: (session: RequestSession) => Promise<Result.Result<A, E>>,
) =>
  CurrentSession.use((session) => Effect.promise(() => run(session))).pipe(
    Effect.flatMap(Effect.fromResult),
    Effect.catchIf(
      (failure): failure is Extract<E, UnexpectedFailure> =>
        isUnexpectedFailure(failure),
      (failure) => Effect.die(defectOf(failure)),
    ),
  );

const runTeamManagementWrite = <E extends TeamFailure>(
  write: (
    management: TeamManagement["Service"],
  ) => Effect.Effect<void, E, CompanyContext>,
) =>
  runServiceForCurrentSession((session) =>
    runTeamManagement(session, (management) =>
      write(management).pipe(Effect.as({})),
    ),
  );

const memberName = ({ name, email }: Member) => name.trim() || email;

const teamMembersOrNullWhenListFails = CompanyMembers.use(
  (members) => members.list,
).pipe(
  Effect.map((members) =>
    members.map((member) => ({
      userId: member.userId,
      name: memberName(member),
    })),
  ),
  Effect.catchTag("MemberListError", (failure) =>
    Effect.sync(() => reportError(defectOf(failure))).pipe(Effect.as(null)),
  ),
);

const handlers: {
  readonly me: DecodedHandlers<typeof MeGroup>;
  readonly teams: DecodedHandlers<typeof TeamsGroup>;
  readonly members: DecodedHandlers<typeof MembersGroup>;
} = {
  me: {
    get: () =>
      CurrentSession.useSync((session) => ({
        userId: session.userId,
        name: session.userName,
        canManage: isManager(session.role),
      })),
  },
  teams: {
    list: () =>
      runServiceForCurrentSession((session) =>
        runTeamReads(session, (reads) =>
          reads.listTeams.pipe(Effect.map((teams) => ({ teams }))),
        ),
      ),
    create: ({ payload }) =>
      runServiceForCurrentSession((session) =>
        runTeamManagement(session, (management) =>
          management.createTeam(payload.name),
        ),
      ),
    get: ({ params }) =>
      runServiceForCurrentSession((session) =>
        runTeamReads(session, (reads) =>
          Effect.all(
            {
              team: reads.getTeam(params.teamId),
              members: teamMembersOrNullWhenListFails,
            },
            { concurrency: "unbounded" },
          ),
        ),
      ),
    rename: ({ params, payload }) =>
      runTeamManagementWrite((management) =>
        management.renameTeam(params.teamId, payload.name),
      ),
    delete: ({ params }) =>
      runTeamManagementWrite((management) =>
        management.deleteTeam(params.teamId),
      ),
    addSkill: ({ params, payload }) =>
      runTeamManagementWrite((management) =>
        management.addSkill(params.teamId, payload.name),
      ),
    removeSkill: ({ params }) =>
      runTeamManagementWrite((management) =>
        management.removeSkill(params.skillId),
      ),
    assign: ({ params }) =>
      runTeamManagementWrite((management) =>
        management.assign(params.teamId, params.userId),
      ),
    unassign: ({ params }) =>
      runTeamManagementWrite((management) =>
        management.unassign(params.teamId, params.userId),
      ),
    saveMyLevels: ({ params, payload }) =>
      runServiceForCurrentSession((session) =>
        runTeamService(session, (teams) =>
          teams.saveMyLevels(params.teamId, payload.levels).pipe(Effect.as({})),
        ),
      ),
  },
  members: {
    list: () =>
      runServiceForCurrentSession((session) =>
        runServiceWithoutDb(session, () =>
          CompanyMembers.use((companyMembers) => companyMembers.list).pipe(
            Effect.map((members) => ({
              members: members.map((member) => ({
                name: memberName(member),
                email: member.email,
                ...(member.role && { role: member.role }),
              })),
            })),
          ),
        ),
      ),
  },
};

const isResponseEncodeFailure = (error: unknown) =>
  HttpApiError.HttpApiSchemaError.is(error) &&
  (error.kind === "Body" || error.kind === "ResponseHeaders");

const unexpectedFailureReporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause }) => {
    for (const reason of cause.reasons)
      Match.valueTags(reason, {
        Die: ({ defect }) => reportError(defect),
        Fail: ({ error }) => {
          if (isResponseEncodeFailure(error)) reportError(error);
        },
        Interrupt: () => {},
      });
  },
};

export const SpaApiLive = HttpApiBuilder.layer(SpaApi).pipe(
  Layer.provide([
    HttpApiBuilder.group(SpaApi, "me", (h) => h.handleAll(handlers.me)),
    HttpApiBuilder.group(SpaApi, "teams", (h) => h.handleAll(handlers.teams)),
    HttpApiBuilder.group(SpaApi, "members", (h) =>
      h.handleAll(handlers.members),
    ),
  ]),
  Layer.provide(AuthenticatedLive),
  Layer.provide(ErrorReporter.layer([unexpectedFailureReporter])),
  Layer.provide(HttpServer.layerServices),
);

const webHandlerOf = (live: typeof SpaApiLive) =>
  HttpRouter.toWebHandler(live, { disableLogger: true }).handler;

export const spaApiResponder = (live = SpaApiLive) => {
  let respond: ReturnType<typeof webHandlerOf> | undefined;
  return (request: Request, check: SessionCheck) => {
    respond ??= webHandlerOf(live);
    return respond(request, Context.make(SessionCheckRef, check));
  };
};
