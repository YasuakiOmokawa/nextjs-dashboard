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

export async function buildProviderAuthResponse(
  props: Props
): Promise<boolean | string> {
  if (await userExistsWithoutLinkedAccount(props)) {
    await setFlash({
      type: "error",
      message: `Email: ${props.profileEmail} のアカウントが存在します。ログインして連携してください。`,
    });
    return "/login";
  }
  if (await isSigninWithoutLinkedAccount(props)) {
    await setFlash({
      type: "error",
      message: "アカウントが存在しません。",
    });
    return "/login";
  }
  if (await isSignupWithExistingLinkedAccount(props)) {
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

async function userExistsWithoutLinkedAccount(props: Props): Promise<boolean> {
  return (
    ["githubSignup", "githubSignin"].includes(props.authType) &&
    !!(await adapter.getUserByEmail?.(props.profileEmail)) &&
    !(await hasLinkedAccount(props))
  );
}

async function isSigninWithoutLinkedAccount(props: Props): Promise<boolean> {
  return props.authType === "githubSignin" && !(await hasLinkedAccount(props));
}

async function isSignupWithExistingLinkedAccount(
  props: Props
): Promise<boolean> {
  return props.authType === "githubSignup" && (await hasLinkedAccount(props));
}

async function hasLinkedAccount(props: Props): Promise<boolean> {
  return !!(await adapter.getUserByAccount?.({
    providerAccountId: props.providerAccountId,
    provider: props.provider,
  }));
}
