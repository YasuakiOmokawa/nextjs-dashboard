import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Resend from "next-auth/providers/resend";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/prisma";
import { getAndDeleteCookie } from "@/lib/auth/serverUtils";
import { buildProviderAuthResponse } from "./lib/auth/buildProviderAuthResponse";

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
    async signIn({ account, profile }) {
      return buildProviderAuthResponse({
        authType: (await getAndDeleteCookie("mysite_auth_type")) ?? "",
        profileEmail: profile?.email ?? "",
        providerAccountId: account?.providerAccountId ?? "",
        provider: account?.provider ?? "",
      });
    },
  },
});
