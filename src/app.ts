import { Result } from "effect";
import { HttpApi } from "effect/http-api";
import { type Context, Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import type { CompanyId } from "@/db/ids";
import { reportError } from "@/src/lib/report-error";
import type { RequestSession } from "@/src/services";
import {
  CompanyTeamList,
  type TeamListStub,
} from "@/src/services/company-team-list";
import {
  SESSION_HEADER,
  SessionChanged,
  SpaApi,
  Unauthenticated,
} from "@/src/spa-contract";
import { type SessionCheck, spaApiResponder } from "@/src/spa-http-api";
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

export type Env = AuthEnv & {
  readonly HYPERDRIVE: { connectionString: string };
  readonly COMPANY_TEAM_LIST: {
    getByName(name: string): TeamListStub;
  };
  readonly CF_VERSION_METADATA: { readonly id: string };
  readonly SENTRY_DSN?: string;
};
type AppEnv = { Bindings: Env };

export const companyTeamListOf = (env: Env, companyId: CompanyId) =>
  CompanyTeamList.fromStub(
    () => env.COMPANY_TEAM_LIST.getByName(companyId),
    env.CF_VERSION_METADATA.id,
  );

const authGuardOfRequest = (c: Context<AppEnv>) =>
  authGuardOf(c.env, c.req.header("Cookie"));

// 事業所の無い人も undefined (401) にする。taimei-auth のログインの入口が事業所の登録へ送る
const verifiedSessionOf = async (c: Context<AppEnv>) => {
  const guard = authGuardOfRequest(c);
  const verified = await guard.verifySession();
  const session = verified.ok
    ? requestSessionOf(verified.data, guard.listMembers, (companyId) =>
        companyTeamListOf(c.env, companyId),
      )
    : undefined;
  if (!session) return undefined;
  const mark = `${session.companyId} ${session.userId} ${c.env.CF_VERSION_METADATA.id}`;
  return { session, mark };
};

const sessionCheckOf = (
  c: Context<AppEnv>,
  verified: { session: RequestSession; mark: string } | undefined,
): SessionCheck => {
  if (!verified) return Result.fail(new Unauthenticated());
  const markOfPage = c.req.header(SESSION_HEADER);
  return markOfPage !== undefined && markOfPage !== verified.mark
    ? Result.fail(new SessionChanged())
    : Result.succeed(verified.session);
};

const originOf = (url: string) => new URL(url).origin;

const callbackPathValidator = validator("query", (query, c) => ({
  callbackPath: sameOriginCallbackPath(
    typeof query.callbackUrl === "string" ? query.callbackUrl : undefined,
    originOf(c.req.url),
  ),
}));

export const app = new Hono<AppEnv>()
  .onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    reportError(error);
    return c.text("Internal Server Error", 500);
  })
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
  );

const respondSpaApi = spaApiResponder();

HttpApi.reflect(SpaApi, {
  onGroup: () => {},
  onEndpoint: ({ endpoint }) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const verified = await verifiedSessionOf(c);
      const response = await respondSpaApi(
        c.req.raw,
        sessionCheckOf(c, verified),
      );
      if (verified) response.headers.set(SESSION_HEADER, verified.mark);
      return response;
    });
  },
});
