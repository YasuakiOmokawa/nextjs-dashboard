import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async authorized({ auth, request: {} }) {
      const isLoggedIn = !!auth?.user;
      if (!isLoggedIn) {
        return false;
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
