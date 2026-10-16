export const TAIMEI_AUTH_RPC_PATH = "/rpc";

export const MAGIC_LINK_LIFETIME_MS = 5 * 60 * 1000;

export type AuthErrorReason = "signin_failed" | "signup_already_completed";

export const buildAuthErrorUrl = (
  authBaseUrl: string,
  reason: AuthErrorReason,
) => {
  const url = new URL("/auth/error", authBaseUrl);
  url.searchParams.set("reason", reason);
  return url.toString();
};

type ServiceScreenOptions = {
  readonly authBaseUrl: string;
  readonly service: string;
  readonly returnTo: string;
};

const buildServiceScreenUrl = (
  path: string,
  { authBaseUrl, service, returnTo }: ServiceScreenOptions,
) => {
  const url = new URL(path, authBaseUrl);
  url.searchParams.set("service_name", service);
  url.searchParams.set("redirect_url", returnTo);
  return url.toString();
};

export const buildCompanySignupUrl = (options: ServiceScreenOptions) =>
  buildServiceScreenUrl("/auth/signup/company", options);

export const buildInviteMembersUrl = (options: ServiceScreenOptions) =>
  buildServiceScreenUrl("/account/members", options);

export const buildAccountUrl = (authBaseUrl: string) =>
  new URL("/account", authBaseUrl).toString();
