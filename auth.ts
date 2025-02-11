import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Credentials from "next-auth/providers/credentials";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { loginSchema } from "./app/lib/schema/login/schema";

async function getUser(email: string, password: string) {
  try {
    const userSelectionById = {
      id: true,
      name: true,
      password: true,
      email: true,
    } satisfies Prisma.usersSelect;

    const user = await new PrismaClient().users.findUnique({
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

export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = loginSchema.safeParse(credentials);
        if (!parsedCredentials.success) return null;
        const user = await getUser(
          parsedCredentials.data.email,
          parsedCredentials.data.password
        );
        if (!user) return null;

        return user;
      },
    }),
  ],
});
