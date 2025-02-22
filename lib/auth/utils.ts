import { Session } from "next-auth";
import { NextURL } from "next/dist/server/web/next-url";

export type Authorize = {
  isLoggedIn: boolean;
  isAuthjsRequest: boolean;
  isLoggedInSignInRequest: boolean;
  isNotLoggedInRootRequest: boolean;
};

export const verifyLoggedIn = (
  authorize: Authorize,
  auth: Session | null
): Authorize => ({
  ...authorize,
  isLoggedIn: !!auth?.user,
});

export const verifyAuthjsRequest = (
  authorize: Authorize,
  nextUrl: NextURL
): Authorize => {
  if (authorize.isLoggedIn) {
    return authorize;
  } else {
    return {
      ...authorize,
      isAuthjsRequest:
        nextUrl.pathname === "/api/auth/verify-request" ||
        nextUrl.searchParams.has("token"),
    };
  }
};

export const verifyLoggedInSignInRequest = (
  authorize: Authorize,
  nextUrl: NextURL
): Authorize => {
  if (authorize.isLoggedIn) {
    return {
      ...authorize,
      isLoggedInSignInRequest: ["/login", "/"].includes(nextUrl.pathname),
    };
  } else {
    return authorize;
  }
};

export const verifyNotLoggedInRootRequest = (
  authorize: Authorize,
  nextUrl: NextURL
): Authorize => {
  if (authorize.isLoggedIn) {
    return authorize;
  } else {
    return {
      ...authorize,
      isNotLoggedInRootRequest: nextUrl.pathname === "/",
    };
  }
};
