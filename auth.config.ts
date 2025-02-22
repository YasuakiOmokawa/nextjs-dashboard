import type { NextAuthConfig } from "next-auth";
import {
  Authorize,
  verifyAuthjsRequest,
  verifyLoggedIn,
  verifyLoggedInApplicationRequest,
  verifyNotLoggedInApplicationRequest,
} from "./lib/auth/utils";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const initial: Authorize = {
        isLoggedIn: false,
        isAuthjsRequest: false,
        isLoggedInApplicationRequest: false,
        isNotLoggedInApplicationRequest: false,
      };

      const loggedInVerified = verifyLoggedIn(initial, auth);
      const authjsVerified = verifyAuthjsRequest(loggedInVerified, nextUrl);
      const loggedInApplicationVerified = verifyLoggedInApplicationRequest(
        authjsVerified,
        nextUrl
      );
      const authorize = verifyNotLoggedInApplicationRequest(
        loggedInApplicationVerified,
        nextUrl
      );

      if (
        authorize.isAuthjsRequest ||
        authorize.isNotLoggedInApplicationRequest
      ) {
        return true;
      } else if (authorize.isLoggedInApplicationRequest) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      } else {
        return true;
      }
    },
  },
} satisfies NextAuthConfig;
