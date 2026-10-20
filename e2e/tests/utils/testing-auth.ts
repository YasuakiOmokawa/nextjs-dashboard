import type { Browser } from "@playwright/test";
import {
  createTestingClient,
  type SignedInUser,
  type SignedInUserRequest,
} from "@taimei-code/auth-client/testing";

const APP_BASE_URL =
  process.env.APP_BASE_URL ?? "http://app.taimei-code.local:3001";
export const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL ?? "http://auth.taimei-code.local:3100";
export const AFTER_SIGN_IN_URL = `${APP_BASE_URL}/auth/after-signin`;

export const testing = createTestingClient(AUTH_BASE_URL);

export const createUser = ({
  companies = [{ role: "OWNER" }],
  name,
}: Partial<Pick<SignedInUserRequest, "companies" | "name">> = {}) =>
  testing.createSignedInUser({
    name,
    companies,
    returnTo: AFTER_SIGN_IN_URL,
  });

export const signIn = async (browser: Browser, user: SignedInUser) => {
  const context = await browser.newContext();
  const response = await context.request.get(user.loginUrl, {
    maxRedirects: 0,
  });
  if (response.status() !== 302) {
    await context.close();
    throw new Error(`ログイン URL が ${response.status()}`);
  }
  return context;
};
