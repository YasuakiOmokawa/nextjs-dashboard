import type { NextAuthConfig } from "next-auth";
import { buildResponse } from "./lib/auth/utils";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      return buildResponse(auth, nextUrl);
    },
  },
} satisfies NextAuthConfig;
