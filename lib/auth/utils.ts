import { Session } from "next-auth";
import { NextURL } from "next/dist/server/web/next-url";

export type Authorize = {
  isLoggedIn: boolean;
  isAuthjsRequest: boolean;
  isLoggedInApplicationRequest: boolean;
  isNotLoggedInApplicationRequest: boolean;
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

export const verifyLoggedInApplicationRequest = (
  authorize: Authorize,
  nextUrl: NextURL
): Authorize => {
  if (authorize.isLoggedIn) {
    return {
      ...authorize,
      isLoggedInApplicationRequest: ["/login", "/"].includes(nextUrl.pathname),
    };
  } else {
    return authorize;
  }
};

export const verifyNotLoggedInApplicationRequest = (
  authorize: Authorize,
  nextUrl: NextURL
): Authorize => {
  if (authorize.isLoggedIn) {
    return authorize;
  } else {
    return {
      ...authorize,
      isNotLoggedInApplicationRequest: nextUrl.pathname === "/",
    };
  }
};
