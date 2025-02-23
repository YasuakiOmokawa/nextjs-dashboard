import { Session } from "next-auth";
import { NextURL } from "next/dist/server/web/next-url";

export const buildResponse = (
  auth: Session | null,
  url: NextURL
): boolean | Response => {
  const loggedIn = isLoggedIn(auth);
  if (
    isAuthorizeRequest(loggedIn, url) ||
    isNotLoggedInRootRequest(loggedIn, url)
  ) {
    return true;
  } else if (isLoggedInSignInRequest(loggedIn, url)) {
    return Response.redirect(new URL("/dashboard", url));
  } else if (loggedIn) {
    return true;
  } else {
    return false;
  }
};

const isLoggedIn = (auth: Session | null): boolean => !!auth?.user;

const isAuthorizeRequest = (isLoggedIn: boolean, url: NextURL): boolean =>
  !isLoggedIn &&
  (url.pathname === "/api/auth/verify-request" || url.searchParams.has("token"))
    ? true
    : false;

const isLoggedInSignInRequest = (isLoggedIn: boolean, url: NextURL): boolean =>
  isLoggedIn && ["/login", "/"].includes(url.pathname) ? true : false;

const isNotLoggedInRootRequest = (isLoggedIn: boolean, url: NextURL): boolean =>
  !isLoggedIn && url.pathname === "/" ? true : false;
