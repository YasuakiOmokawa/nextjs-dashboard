import {
  type ConnectTransportOptions,
  createConnectTransport,
} from "@connectrpc/connect-web";
import {
  AUTH_RPC_PATH,
  buildAccountUrl,
  buildAuthErrorUrl,
  buildAuthLoginUrl,
  buildCompanySignupUrl,
  buildMembersUrl,
  createAuthClient,
  createAuthGuard,
  createServiceKeyInterceptor,
  extractSessionTokenFromCookieHeader,
  isJustSignedUp,
  type ListMembersResult,
  type SessionData,
  type VerifyResult,
} from "@taimei-code/auth-client";
import { CompanyId } from "@/db/company-id";
import type { CheckMemberships } from "@/src/lib/purge-departed";
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

export const authTransportOptionsOf = (env: AuthEnv) => {
  const sendToTaimeiAuth: typeof fetch = env.AUTH_SERVICE_URL
    ? (input, init) => fetch(input, init)
    : (input, init) => env.AUTH.fetch(input, init);
  return {
    baseUrl: `${env.AUTH_SERVICE_URL ?? SERVICE_BINDING_UNUSED_ORIGIN}${AUTH_RPC_PATH}`,
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

const signInFailedLocation = (authUrl: string) =>
  buildAuthErrorUrl({ authBaseUrl: authUrl, reason: "signin_failed" });

export const sameOriginCallbackPath = (
  callbackUrl: string | undefined,
  origin: string,
) => {
  if (!callbackUrl || !URL.canParse(callbackUrl, origin)) return undefined;
  const url = new URL(callbackUrl, origin);
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
  buildMembersUrl({
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
  if (!result.ok) return signInFailedLocation(authUrl);
  const landing = new URL(callbackPath, origin).toString();
  if (!result.data.companyId)
    return buildCompanySignupUrl({
      authBaseUrl: authUrl,
      service: SERVICE_NAME,
      returnTo: landing,
    });
  return landing;
};

export const afterSignUpLocation = (
  result: VerifyResult,
  authUrl: string,
  origin: string,
) => {
  if (!result.ok) return signInFailedLocation(authUrl);
  if (!isJustSignedUp(result.data))
    return buildAuthErrorUrl({
      authBaseUrl: authUrl,
      reason: "signup_already_completed",
    });
  return new URL(DEFAULT_LANDING_PATH, origin).toString();
};

export const accountLocation = (authUrl: string) =>
  buildAccountUrl({ authBaseUrl: authUrl });
