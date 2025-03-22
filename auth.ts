import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Resend from "next-auth/providers/resend";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/prisma";
import { getAndDeleteCookie } from "@/lib/auth/serverUtils";
import { setFlash } from "./lib/flash-toaster";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  debug: true,
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  providers: [
    Resend({
      from: "notifications@transactional.ys-polaris.net",
    }),
    GitHub,
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      const dbUser = await prisma.user.findUniqueOrThrow({
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
        where: { id: String(token.id) },
      });

      session.user = {
        ...session.user,
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        image: dbUser.image,
      };

      return session;
    },
    async signIn({ account }) {
      const auth_type = await getAndDeleteCookie("mysite_auth_type");

      if (auth_type === "signin" && !account) {
        await setFlash({
          type: "error",
          message: "アカウントが存在しません。",
        });
        return "/login";
      } else if (auth_type === "signup" && account) {
        await setFlash({
          type: "error",
          message: "アカウントがすでに存在します。",
        });
        return "/signup";
      } else {
        return true;
      }
    },
  },
});
