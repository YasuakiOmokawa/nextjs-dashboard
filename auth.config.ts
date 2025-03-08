import type { NextAuthConfig } from "next-auth";
import { buildNextAuthResponse } from "./lib/auth/utils";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    // NOTE: ミドルウェア経由で動かしたいのでここに書いてる
    authorized({ auth, request: { nextUrl } }) {
      return buildNextAuthResponse(auth, nextUrl);
    },
  },
} satisfies NextAuthConfig;
