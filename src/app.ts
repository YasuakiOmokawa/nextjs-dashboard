import type { Member } from "@taimei-code/auth-client";
import { Effect, Schema } from "effect";
import { type Context, Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { reportUnexpectedFailure } from "@/src/lib/team-failure";
import {
  runManagerScopedService,
  runReadService,
  runScopedService,
  runServiceWithoutDb,
} from "@/src/services";
import { isManager } from "@/src/services/authorization-context";
import { CompanyMembers } from "@/src/services/company-members-service";
import { Team, TeamDetail, TeamReads } from "@/src/services/team-reads";
import {
  LevelEntry,
  MAX_LEVEL_ENTRIES_PER_SAVE,
  TeamManagement,
  TeamService,
} from "@/src/services/team-service";
import {
  type AuthEnv,
  accountLocation,
  afterSignInLocation,
  afterSignUpLocation,
  authGuardOf,
  inviteMembersLocation,
  loginLocation,
  requestSessionOf,
  sameOriginCallbackPath,
} from "./auth";
import {
  encodedJson,
  jsonBody,
  resultJson,
  type SessionVariables,
} from "./run-json";

export type Env = AuthEnv & {
  readonly HYPERDRIVE: { connectionString: string };
};
type AppEnv = { Bindings: Env } & SessionVariables;

const Me = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  canManage: Schema.Boolean,
});
const Teams = Schema.Struct({ teams: Schema.Array(Team) });

const TeamPageResponse = Schema.Struct({
  team: TeamDetail,
  members: Schema.NullOr(
    Schema.Array(Schema.Struct({ userId: Schema.String, name: Schema.String })),
  ),
});

const MyLevelsRequest = Schema.Struct({
  levels: Schema.Array(LevelEntry).check(
    Schema.isMaxLength(MAX_LEVEL_ENTRIES_PER_SAVE),
  ),
});
const EmptyResponse = Schema.Struct({});

const TeamNameRequest = Schema.Struct({ name: Schema.String });
const CreatedTeam = Schema.Struct({ id: Schema.String });

const authGuardOfRequest = (c: Context<AppEnv>) =>
  // biome-ignore lint/plugin/no-raw-request-input: session の cookie は taimei-auth が確かめる
  authGuardOf(c.env, c.req.header("Cookie"));

// 事業所の無い人も 401 にする。taimei-auth のログインの入口が事業所の登録へ送る
const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const guard = authGuardOfRequest(c);
  const verified = await guard.verifySession();
  const session = verified.ok
    ? requestSessionOf(verified.data, guard.listMembers)
    : undefined;
  // biome-ignore lint/plugin/no-direct-json: 401 の本文は定数で、hc の型に入らない
  if (!session) return c.json({ _tag: "Unauthenticated" as const }, 401);
  c.set("session", session);
  await next();
});

const Members = Schema.Struct({
  members: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      email: Schema.String,
      role: Schema.optional(Schema.Literals(["OWNER", "ADMIN", "MEMBER"])),
    }),
  ),
});

const memberName = ({ name, email }: Member) => name.trim() || email;

const memberResponse = (member: Member) => ({
  name: memberName(member),
  email: member.email,
  role: member.role,
});

const teamMemberResponse = (member: Member) => ({
  userId: member.userId,
  name: memberName(member),
});

const teamMembersOrNullWhenListFails = CompanyMembers.use(
  (members) => members.list,
).pipe(
  Effect.map((members) => members.map(teamMemberResponse)),
  Effect.catchTag("MemberListError", (failure) =>
    Effect.sync(() => reportUnexpectedFailure(failure)).pipe(Effect.as(null)),
  ),
);

const originOf = (url: string) => new URL(url).origin;

const teamParamValidator = validator("param", ({ teamId }) => ({
  teamId,
}));

const callbackPathValidator = validator("query", (query, c) => ({
  callbackPath: sameOriginCallbackPath(
    typeof query.callbackUrl === "string" ? query.callbackUrl : undefined,
    originOf(c.req.url),
  ),
}));

export const app = new Hono<AppEnv>()
  .use(csrf())
  .get("/auth", callbackPathValidator, (c) =>
    c.redirect(
      loginLocation(
        c.env.AUTH_URL,
        originOf(c.req.url),
        c.req.valid("query").callbackPath,
      ),
    ),
  )
  .get("/auth/after-signin", callbackPathValidator, async (c) =>
    c.redirect(
      afterSignInLocation(
        await authGuardOfRequest(c).verifySession(),
        c.env.AUTH_URL,
        originOf(c.req.url),
        c.req.valid("query").callbackPath,
      ),
    ),
  )
  .get("/auth/after-signup", async (c) =>
    c.redirect(
      afterSignUpLocation(
        await authGuardOfRequest(c).verifySession(),
        c.env.AUTH_URL,
        originOf(c.req.url),
        Date.now(),
      ),
    ),
  )
  .get("/auth/account", (c) => c.redirect(accountLocation(c.env.AUTH_URL)))
  .get("/auth/account/members", (c) =>
    c.redirect(inviteMembersLocation(c.env.AUTH_URL, originOf(c.req.url))),
  )
  .use(requireSession)
  .get("/api/me", (c) =>
    encodedJson(c, Me, {
      userId: c.var.session.userId,
      name: c.var.session.userName,
      canManage: isManager(c.var.session.role),
    }),
  )
  .get("/api/teams", async (c) =>
    resultJson(
      c,
      Teams,
      await runReadService(c.var.session, () =>
        TeamReads.use((reads) => reads.listTeams).pipe(
          Effect.map((teams) => ({ teams })),
        ),
      ),
    ),
  )
  .post("/api/teams", jsonBody(TeamNameRequest), async (c) => {
    const { name } = c.req.valid("json");
    return resultJson(
      c,
      CreatedTeam,
      await runManagerScopedService(c.var.session, () =>
        TeamManagement.use((management) => management.createTeam(name)),
      ),
    );
  })
  .get("/api/teams/:teamId", teamParamValidator, async (c) => {
    const { teamId } = c.req.valid("param");
    return resultJson(
      c,
      TeamPageResponse,
      await runReadService(c.var.session, () =>
        Effect.all(
          {
            team: TeamReads.use((reads) => reads.getTeam(teamId)),
            members: teamMembersOrNullWhenListFails,
          },
          { concurrency: "unbounded" },
        ),
      ),
    );
  })
  .patch(
    "/api/teams/:teamId",
    teamParamValidator,
    jsonBody(TeamNameRequest),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { name } = c.req.valid("json");
      return resultJson(
        c,
        EmptyResponse,
        await runManagerScopedService(c.var.session, () =>
          TeamManagement.use((management) =>
            management.renameTeam(teamId, name),
          ).pipe(Effect.as({})),
        ),
      );
    },
  )
  .delete("/api/teams/:teamId", teamParamValidator, async (c) => {
    const { teamId } = c.req.valid("param");
    return resultJson(
      c,
      EmptyResponse,
      await runManagerScopedService(c.var.session, () =>
        TeamManagement.use((management) => management.deleteTeam(teamId)).pipe(
          Effect.as({}),
        ),
      ),
    );
  })
  .put(
    "/api/teams/:teamId/my-levels",
    teamParamValidator,
    jsonBody(MyLevelsRequest),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { levels } = c.req.valid("json");
      return resultJson(
        c,
        EmptyResponse,
        await runScopedService(c.var.session, () =>
          TeamService.use((teams) => teams.saveMyLevels(teamId, levels)).pipe(
            Effect.as({}),
          ),
        ),
      );
    },
  )
  .get("/api/members", async (c) =>
    resultJson(
      c,
      Members,
      await runServiceWithoutDb(c.var.session, () =>
        CompanyMembers.use((companyMembers) => companyMembers.list).pipe(
          Effect.map((members) => ({ members: members.map(memberResponse) })),
        ),
      ),
    ),
  );

export type AppType = typeof app;
