import type { NextAuthConfig } from "next-auth";
import {
  Authorize,
  verifyAuthjsRequest,
  verifyLoggedIn,
  verifyLoggedInSignInRequest,
  verifyNotLoggedInRootRequest,
} from "./lib/auth/utils";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      let authorize: Authorize = {
        isLoggedIn: false,
        isAuthjsRequest: false,
        isLoggedInSignInRequest: false,
        isNotLoggedInRootRequest: false,
      };

      authorize = verifyLoggedIn(authorize, auth);
      authorize = verifyAuthjsRequest(authorize, nextUrl);
      authorize = verifyLoggedInSignInRequest(authorize, nextUrl);
      authorize = verifyNotLoggedInRootRequest(authorize, nextUrl);

      if (authorize.isAuthjsRequest || authorize.isNotLoggedInRootRequest) {
        return true;
      } else if (authorize.isLoggedInSignInRequest) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      } else if (authorize.isLoggedIn) {
        return true;
      } else {
        return false;
      }
    },
  },
} satisfies NextAuthConfig;
