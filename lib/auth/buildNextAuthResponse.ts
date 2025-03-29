import { Session } from "next-auth";
import { NextURL } from "next/dist/server/web/next-url";

export const buildNextAuthResponse = (
  auth: Session | null,
  url: NextURL
): boolean | Response => {
  const loggedIn = isLoggedIn(auth);
  if (
    isAuthorizeRequest(loggedIn, url) ||
    isNotLoggedInAuthenticateRequest(loggedIn, url)
  ) {
    return true;
  } else if (isLoggedInAuthenticateRequest(loggedIn, url)) {
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
  (new RegExp("^/api/auth/*").test(url.pathname) ||
    url.searchParams.has("token"))
    ? true
    : false;

const isLoggedInAuthenticateRequest = (
  isLoggedIn: boolean,
  url: NextURL
): boolean =>
  isLoggedIn && new RegExp("^/$|^/login$|^/signup$").test(url.pathname)
    ? true
    : false;

const isNotLoggedInAuthenticateRequest = (
  isLoggedIn: boolean,
  url: NextURL
): boolean =>
  !isLoggedIn && new RegExp("^/$|^/login$|^/signup$").test(url.pathname)
    ? true
    : false;
