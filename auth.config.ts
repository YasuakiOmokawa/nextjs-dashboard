import type { NextAuthConfig } from "next-auth";
import { buildNextAuthResponse } from "./lib/auth/utils";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      return buildNextAuthResponse(auth, nextUrl);
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.id);

      return session;
    },
  },
} satisfies NextAuthConfig;
