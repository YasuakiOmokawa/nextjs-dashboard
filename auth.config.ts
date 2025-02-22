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
      const initialAuthorize: Authorize = {
        isLoggedIn: false,
        isAuthjsRequest: false,
        isLoggedInSignInRequest: false,
        isNotLoggedInRootRequest: false,
      };

      const loggedInVerified = verifyLoggedIn(initialAuthorize, auth);
      const authjsVerified = verifyAuthjsRequest(loggedInVerified, nextUrl);
      const loggedInSignInVerified = verifyLoggedInSignInRequest(
        authjsVerified,
        nextUrl
      );
      const allVerifiedAuthorize = verifyNotLoggedInRootRequest(
        loggedInSignInVerified,
        nextUrl
      );

      if (
        allVerifiedAuthorize.isAuthjsRequest ||
        allVerifiedAuthorize.isNotLoggedInRootRequest
      ) {
        return true;
      } else if (allVerifiedAuthorize.isLoggedInSignInRequest) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      } else if (allVerifiedAuthorize.isLoggedIn) {
        return true;
      } else {
        return false;
      }
    },
  },
} satisfies NextAuthConfig;
