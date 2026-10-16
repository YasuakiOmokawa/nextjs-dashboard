import {
  type ConnectTransportOptions,
  createConnectTransport,
} from "@connectrpc/connect-web";
import {
  buildAuthLoginUrl,
  createAuthClient,
  createAuthGuard,
  createServiceKeyInterceptor,
  extractSessionTokenFromCookieHeader,
  type ListMembersResult,
  type SessionData,
  type VerifyResult,
} from "@taimei-code/auth-client";
import { CompanyId } from "@/db/ids";
import type { CheckMemberships } from "@/src/lib/purge-departed";
import { CompanyMembers } from "@/src/services/company-members-service";
import type { CompanyTeamList } from "@/src/services/company-team-list";
import type { RequestSession } from "@/src/services/request-session";
import {
  buildAccountUrl,
  buildAuthErrorUrl,
  buildCompanySignupUrl,
  buildInviteMembersUrl,
  MAGIC_LINK_LIFETIME_MS,
  TAIMEI_AUTH_RPC_PATH,
} from "@/src/taimei-auth-contract";

export type AuthEnv = {
  readonly AUTH: { fetch: typeof fetch };
  readonly AUTH_URL: string;
  readonly AUTH_SERVICE_URL?: string;
  readonly AUTH_SERVICE_KEY?: string;
};

const AUTH_RPC_TIMEOUT_MS = 10_000;
const SERVICE_BINDING_UNUSED_ORIGIN = "https://taimei-auth";

export const authTransportOptionsOf = (env: AuthEnv) => {
  const sendToTaimeiAuth: typeof fetch = env.AUTH_SERVICE_URL
    ? (input, init) => fetch(input, init)
    : (input, init) => env.AUTH.fetch(input, init);
  return {
    baseUrl: `${env.AUTH_SERVICE_URL ?? SERVICE_BINDING_UNUSED_ORIGIN}${TAIMEI_AUTH_RPC_PATH}`,
    fetch: (input, init) =>
      sendToTaimeiAuth(input, { ...init, redirect: "manual" }),
    defaultTimeoutMs: AUTH_RPC_TIMEOUT_MS,
    interceptors: env.AUTH_SERVICE_KEY
      ? [createServiceKeyInterceptor(env.AUTH_SERVICE_KEY)]
      : [],
  } satisfies ConnectTransportOptions;
};

const authClientOf = (env: AuthEnv) =>
  createAuthClient({
    transport: createConnectTransport(authTransportOptionsOf(env)),
  });

export const checkMembershipsOf = (env: AuthEnv): CheckMemberships => {
  const { companyService } = authClientOf(env);
  return (request) => companyService.checkMemberships(request);
};

export const once = <Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
) => {
  let called: { readonly value: R } | undefined;
  return (...args: Args) => {
    called ??= { value: fn(...args) };
    return called.value;
  };
};

export type AuthGuard = Pick<
  ReturnType<typeof createAuthGuard>,
  "getSession" | "listMembers"
>;

export const authGuardOf = (
  env: AuthEnv,
  cookieHeader: string | undefined,
): AuthGuard =>
  createAuthGuard({
    client: authClientOf(env),
    getSessionToken: async () =>
      extractSessionTokenFromCookieHeader(cookieHeader ?? ""),
    cache: once,
  });

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

const SERVICE_NAME = "taimei";

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
    service: SERVICE_NAME,
    returnTo: afterSignIn.toString(),
    signUpUrl: new URL("/auth/after-signup", origin).toString(),
  });
};

export const inviteMembersLocation = (authUrl: string, origin: string) =>
  buildInviteMembersUrl({
    authBaseUrl: authUrl,
    service: SERVICE_NAME,
    returnTo: new URL(DEFAULT_LANDING_PATH, origin).toString(),
  });

export const afterSignInLocation = (
  result: VerifyResult,
  authUrl: string,
  origin: string,
  callbackPath = DEFAULT_LANDING_PATH,
) => {
  if (!result.ok) return buildAuthErrorUrl(authUrl, "signin_failed");
  const landing = new URL(callbackPath, origin).toString();
  if (!result.data.companyId)
    return buildCompanySignupUrl({
      authBaseUrl: authUrl,
      service: SERVICE_NAME,
      returnTo: landing,
    });
  return landing;
};

const NEW_USER_WINDOW_MS = MAGIC_LINK_LIFETIME_MS;

export const afterSignUpLocation = (
  result: VerifyResult,
  authUrl: string,
  origin: string,
  now: number,
) => {
  if (!result.ok) return buildAuthErrorUrl(authUrl, "signin_failed");
  const createdAt = Date.parse(result.data.user.createdAt);
  if (Number.isNaN(createdAt))
    return buildAuthErrorUrl(authUrl, "signin_failed");
  if (now - createdAt >= NEW_USER_WINDOW_MS)
    return buildAuthErrorUrl(authUrl, "signup_already_completed");
  return new URL(DEFAULT_LANDING_PATH, origin).toString();
};

export const accountLocation = buildAccountUrl;
