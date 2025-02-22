import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      console.log(nextUrl);
      const isLoggedIn = !!auth?.user;

      // ログインしてなかったら、auth.jsのリクエスト検証パスではログイン画面にリダイレクトしてほしくない
      if (!isLoggedIn && nextUrl.pathname === "/api/auth/verify-request") {
        return true;
      }
      // ログインしてなかったら、auth.jsのトークン検証パスではログイン画面にリダイレクトしてほしくない
      if (!isLoggedIn && nextUrl.searchParams.has("token")) return true;
      // ログインしてなかったら、ログイン前だけに表示してほしいパスに遷移してほしい
      if (!isLoggedIn && nextUrl.pathname === "/") return true;

      // ログインしてたら、ログイン前だけに表示してほしいパスに遷移してほしくない
      if (isLoggedIn && ["/login", "/"].includes(nextUrl.pathname)) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
