import { createConnectTransport } from "@connectrpc/connect-web";
import {
  buildAuthLoginUrl,
  createAuthClient,
  createAuthGuard,
  createServiceKeyInterceptor,
  extractSessionTokenFromCookieHeader,
  type ListMembersResult,
  Result,
  type SessionData,
  type VerifyResult,
} from "@taimei-code/auth-client";
import { CompanyId } from "@/db/ids";
import type { CheckMemberships } from "@/src/lib/purge-departed";
import { reportError } from "@/src/lib/report-error";
import { CompanyMembers } from "@/src/services/company-members-service";
import type { CompanyTeamList } from "@/src/services/company-team-list";
import type { RequestSession } from "@/src/services/request-session";

export type AuthEnv = {
  readonly AUTH: { fetch: typeof fetch };
  readonly AUTH_URL: string;
  readonly AUTH_SERVICE_URL?: string;
  readonly AUTH_SERVICE_KEY?: string;
};

const AUTH_RPC_TIMEOUT_MS = 10_000;
const SERVICE_BINDING_UNUSED_ORIGIN = "https://taimei-auth";

const authClientOf = (env: AuthEnv) => {
  // 手元と e2e の taimei-auth は Bun のサーバーで、Service Binding が届かない
  const sendToTaimeiAuth: typeof fetch = env.AUTH_SERVICE_URL
    ? (input, init) => fetch(input, init)
    : (input, init) => env.AUTH.fetch(input, init);
  return createAuthClient({
    transport: createConnectTransport({
      baseUrl: `${env.AUTH_SERVICE_URL ?? SERVICE_BINDING_UNUSED_ORIGIN}/rpc`,
      // connect-web は redirect: "error" を付けるが、workerd の fetch は follow と manual しか受けない
      fetch: (input, init) =>
        sendToTaimeiAuth(input, { ...init, redirect: "manual" }),
      defaultTimeoutMs: AUTH_RPC_TIMEOUT_MS,
      interceptors: env.AUTH_SERVICE_KEY
        ? [createServiceKeyInterceptor(env.AUTH_SERVICE_KEY)]
        : [],
    }),
  });
};

export const checkMembershipsOf = (env: AuthEnv): CheckMemberships => {
  const { companyService } = authClientOf(env);
  return (request) => companyService.checkMemberships(request);
};

// ponytail: 引数を見ずに最初の結果を返す。SDK が引数を取る関数を cache で包む版に上がったら引数で引く
const once = <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => {
  let called: { readonly value: R } | undefined;
  return (...args: Args) => {
    called ??= { value: fn(...args) };
    return called.value;
  };
};

export const authGuardOf = (env: AuthEnv, cookieHeader: string | undefined) => {
  const guard = createAuthGuard({
    client: authClientOf(env),
    getSessionToken: async () =>
      extractSessionTokenFromCookieHeader(cookieHeader ?? ""),
    cache: once,
  });
  return {
    verifySession: async (): Promise<VerifyResult> => {
      const result = await guard.getSession();
      if (!result.ok && result.reason === Result.UNSPECIFIED)
        reportError(new Error("taimei-auth で session を確かめられなかった"));
      return result;
    },
    listMembers: guard.listMembers,
  };
};

export const requestSessionOf = (
  { companyId, user, role }: SessionData,
  listMembers: () => Promise<ListMembersResult>,
  companyTeamListOf: (companyId: CompanyId) => CompanyTeamList["Service"],
): RequestSession | undefined => {
  if (!companyId) return undefined;
  const id = CompanyId.make(companyId);
  return {
    companyId: id,
    userId: user.id,
    userName: user.name,
    role,
    companyMembers: CompanyMembers.fromListMembers(listMembers),
    companyTeamListOf,
  };
};

const DEFAULT_LANDING_PATH = "/dashboard";

export const sameOriginCallbackPath = (
  callbackUrl: string | undefined,
  origin: string,
) => {
  if (!callbackUrl || !URL.canParse(callbackUrl, origin)) return undefined;
  const url = new URL(callbackUrl, origin);
  // `/.//evil.example` は正規化で `//evil.example` になり、返した path を URL として読み直すと別の origin を指す
  const isProtocolRelative = url.pathname.startsWith("//");
  return url.origin === origin && !isProtocolRelative
    ? url.pathname + url.search
    : undefined;
};

export const loginLocation = (
  authUrl: string,
  origin: string,
  callbackPath: string | undefined,
) => {
  const afterSignIn = new URL("/auth/after-signin", origin);
  if (callbackPath) afterSignIn.searchParams.set("callbackUrl", callbackPath);
  return buildAuthLoginUrl({
    authBaseUrl: authUrl,
    service: "taimei",
    returnTo: afterSignIn.toString(),
    signUpUrl: new URL("/auth/after-signup", origin).toString(),
  });
};

const authErrorLocation = (
  authUrl: string,
  reason: "signin_failed" | "signup_already_completed",
) => {
  const url = new URL("/auth/error", authUrl);
  url.searchParams.set("reason", reason);
  return url.toString();
};

// taimei-auth の画面は service_name と絶対 URL の redirect_url しか受け付けない (allowlist の検査)
const authScreenLocation = (
  authUrl: string,
  path: string,
  returnTo: string,
) => {
  const url = new URL(path, authUrl);
  url.searchParams.set("service_name", "taimei");
  url.searchParams.set("redirect_url", returnTo);
  return url.toString();
};

// 招待を受けると現在の事業所が招待先になるので、/dashboard がその事業所の画面になる (#561)
export const inviteMembersLocation = (authUrl: string, origin: string) =>
  authScreenLocation(
    authUrl,
    "/account/members",
    new URL(DEFAULT_LANDING_PATH, origin).toString(),
  );

export const afterSignInLocation = (
  result: VerifyResult,
  authUrl: string,
  origin: string,
  callbackPath = DEFAULT_LANDING_PATH,
) => {
  if (!result.ok) return authErrorLocation(authUrl, "signin_failed");
  const landing = new URL(callbackPath, origin).toString();
  if (!result.data.companyId)
    return authScreenLocation(authUrl, "/auth/signup/company", landing);
  return landing;
};

// taimei-auth の Magic Link の有効期限 (5 分) と同じ
const NEW_USER_WINDOW_MS = 5 * 60 * 1000;

export const afterSignUpLocation = (
  result: VerifyResult,
  authUrl: string,
  origin: string,
  now: number,
) => {
  if (!result.ok) return authErrorLocation(authUrl, "signin_failed");
  const createdAt = Date.parse(result.data.user.createdAt);
  if (Number.isNaN(createdAt))
    return authErrorLocation(authUrl, "signin_failed");
  if (now - createdAt >= NEW_USER_WINDOW_MS)
    return authErrorLocation(authUrl, "signup_already_completed");
  return new URL(DEFAULT_LANDING_PATH, origin).toString();
};

export const accountLocation = (authUrl: string) =>
  new URL("/account", authUrl).toString();
