import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import GitHub from "next-auth/providers/github";
import { Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import { credentialLoginSchema } from "./app/lib/schema/login/schema";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/prisma";
import { getAndDeleteCookie } from "@/lib/auth/serverUtils";

async function getUser(email: string, password: string) {
  try {
    const userSelectionById = {
      id: true,
      name: true,
      password: true,
      email: true,
    } satisfies Prisma.usersSelect;

    const user = await prisma.users.findUnique({
      select: userSelectionById,
      where: {
        email: email,
      },
    });
    if (!user) return null;
    if (!(await bcrypt.compare(password, user.password))) return null;

    return user;
  } catch (e) {
    console.error("Failed to fetch User:", e);
    throw new Error("Failed to fetch User");
  }
}

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
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = credentialLoginSchema.safeParse(credentials);
        if (!parsedCredentials.success) return null;
        const user = await getUser(
          parsedCredentials.data.email,
          parsedCredentials.data.password
        );
        if (!user) return null;

        return user;
      },
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

      if (auth_type === "signin" && account) {
        return true;
      } else if (auth_type === "signup" && !account) {
        return true;
      } else {
        return false;
      }
    },
  },
});
