import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/prisma";
import { setFlash } from "../flash-toaster";

const adapter = PrismaAdapter(prisma);

type Props = {
  authType: string;
  profileEmail: string;
  providerAccountId: string;
  provider: string;
};

export async function buildProviderAuthResponse(props: Props) {
  if (await isExistsUserButAccountNotLinked(props)) {
    await setFlash({
      type: "error",
      message: `Email: ${props.profileEmail} のアカウントが存在します。ログインして連携してください。`,
    });
    return "/login";
  }
  if (await isSigninButNotExistsLinkedAccount(props)) {
    await setFlash({
      type: "error",
      message: "アカウントが存在しません。",
    });
    return "/login";
  }
  if (await isSignupButExistsLinkedAccount(props)) {
    await setFlash({
      type: "error",
      message: "アカウントがすでに存在します。ログインしてください。",
    });
    return "/login";
  } else {
    if (props.authType === "githubSignin") {
      await setFlash({
        type: "success",
        message: "ログインしました。",
      });
    }
    if (props.authType === "githubSignup") {
      await setFlash({
        type: "success",
        message: "アカウントを登録しました。",
      });
    }
    return true;
  }
}

async function isExistsUserButAccountNotLinked(props: Props): Promise<boolean> {
  return (
    ["githubSignup", "githubSignin"].includes(props.authType) &&
    !!(await adapter.getUserByEmail?.(props.profileEmail)) &&
    !(await isExistsLinkedAccount(props))
  );
}

async function isSigninButNotExistsLinkedAccount(
  props: Props
): Promise<boolean> {
  return (
    props.authType === "githubSignin" && !(await isExistsLinkedAccount(props))
  );
}

async function isSignupButExistsLinkedAccount(props: Props): Promise<boolean> {
  return (
    props.authType === "githubSignup" && (await isExistsLinkedAccount(props))
  );
}

async function isExistsLinkedAccount(props: Props): Promise<boolean> {
  return !!(await adapter.getUserByAccount?.({
    providerAccountId: props.providerAccountId,
    provider: props.provider,
  }));
}
