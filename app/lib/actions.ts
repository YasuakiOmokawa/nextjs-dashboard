"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatesCreateInvoice, validatesUpdateInvoice } from "./validates";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { parseWithZod } from "@conform-to/zod";
import { emailLinkLoginSchema } from "./schema/login/schema";
import { signOut as SignOut } from "@/auth";
import { prisma } from "@/prisma";
import { setFlash } from "@/lib/flash-toaster";
import { deleteUserSchema, userSchema } from "./schema/profile/schema";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { setCustomCookie } from "@/lib/auth/serverUtils";

// for create/update
export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
  formData?: {
    customerId?: string;
    amount?: number;
    status?: string;
  };
};

export async function signOut() {
  await setFlash({
    type: "success",
    message: "ログアウトしました。",
  });
  await SignOut({ redirectTo: "/" });
}

export async function loginWithGithub(
  redirectPath: string,
  _formData: FormData
) {
  setCustomCookie("mysite_auth_type", "githubSignin");

  // NOTE: OAuth認証の場合、Auth.js内部のエラーハンドリングの仕組みに任せるのでtry-catchしない
  await signIn("github", {
    redirectTo: redirectPath,
  });
}

export async function signupWithGithub(
  redirectPath: string,
  _formData: FormData
) {
  setCustomCookie("mysite_auth_type", "githubSignup");

  // NOTE: OAuth認証の場合、Auth.js内部のエラーハンドリングの仕組みに任せるのでtry-catchしない
  await signIn("github", {
    redirectTo: redirectPath,
  });
}

async function isExistsUser(email: string) {
  try {
    const userCount = await prisma.user.count({
      where: { email: email },
    });
    return userCount > 0 ? true : false;
  } catch (e) {
    throw new Error(`Failed to count User: ${e}`);
  }
}

export async function loginWithEmailLink(
  redirectPath: string,
  _prevState: unknown,
  formData: FormData
) {
  const submission = parseWithZod(formData, {
    schema: emailLinkLoginSchema,
  });

  if (submission.status !== "success") {
    return submission.reply();
  }

  if (!(await isExistsUser(submission.value.email))) {
    await setFlash({
      type: "error",
      message: "アカウントが存在しません。",
    });
    return submission.reply();
  }

  try {
    await signIn("resend", {
      email: submission.value.email,
      redirectTo: redirectPath,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      switch (e.type) {
        case "EmailSignInError":
          return submission.reply({
            formErrors: ["Email SignIn Error."],
          });
        default:
          return submission.reply({
            formErrors: ["Something went wrong."],
          });
      }
    }
    throw e;
  }
}

export async function signupWithEmailLink(
  redirectPath: string,
  _prevState: unknown,
  formData: FormData
) {
  const submission = parseWithZod(formData, {
    schema: emailLinkLoginSchema,
  });

  if (submission.status !== "success") {
    return submission.reply();
  }

  if (await isExistsUser(submission.value.email)) {
    await setFlash({
      type: "error",
      message: "アカウントがすでに存在します。",
    });
    return submission.reply();
  }

  try {
    await signIn("resend", {
      email: submission.value.email,
      redirectTo: redirectPath,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      switch (e.type) {
        case "EmailSignInError":
          return submission.reply({
            formErrors: ["Email SignIn Error."],
          });
        default:
          return submission.reply({
            formErrors: ["Something went wrong."],
          });
      }
    }
    throw e;
  }
}

export async function updateUser(
  id: string,
  _prevState: unknown,
  formData: FormData
) {
  const submission = parseWithZod(formData, { schema: userSchema });

  if (submission.status !== "success") {
    return submission.reply();
  }

  await prisma.user.update({
    data: {
      email: submission.value.email,
      name: submission.value.name,
    },
    where: {
      id: id,
    },
  });

  revalidatePath("/setting/profile");
  return submission.reply();
}

export async function createInvoice(_prevState: State, formData: FormData) {
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = validatesCreateInvoice(rawFormData);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Invalid. Failed to Create Invoice.",
      // return inputed value to form
      formData: {
        customerId: rawFormData?.customerId
          ? String(rawFormData.customerId)
          : undefined,
        amount: rawFormData?.amount ? Number(rawFormData.amount) : undefined,
        status: rawFormData?.status ? String(rawFormData.status) : undefined,
      },
    };
  }

  const { amount, status, customerId } = validatedFields.data;
  const amountInCents = amount * 100;

  await prisma.invoices.create({
    data: {
      customer_id: customerId,
      amount: amountInCents,
      status: status,
    },
  });

  revalidatePath("/dashboard/invoices"); // update page cache
  redirect("/dashboard/invoices");
}

export async function updateInvoice(
  id: string,
  _prevState: State,
  formData: FormData
) {
  const rawFormData = Object.fromEntries(formData.entries());
  const validatedFields = validatesUpdateInvoice(rawFormData);

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Invalid. Failed to Update Invoice.",
      // return inputed value to form
      formData: {
        customerId: rawFormData?.customerId
          ? String(rawFormData.customerId)
          : undefined,
        amount: rawFormData?.amount ? Number(rawFormData.amount) : undefined,
        status: rawFormData?.status ? String(rawFormData.status) : undefined,
      },
    };
  }

  const { amount, status, customerId } = validatedFields.data;
  const amountInCents = amount * 100;

  await prisma.invoices.update({
    data: {
      amount: amountInCents,
      status: status,
      customer_id: customerId,
    },
    where: {
      id: id,
    },
  });

  revalidatePath("/dashboard/invoices");
  redirect("/dashboard/invoices");
}

export async function deleteInvoice(id: string, _prevState: unknown) {
  await prisma.invoices.delete({
    where: { id: id },
  });
  await setFlash({ type: "success", message: "delete invoice successful." });
  revalidatePath("/dashboard/invoices");
}

export async function deleteUser(
  id: string | null | undefined,
  _prevState: unknown,
  formData: FormData
) {
  if (id) formData.set("id", id);

  const submission = parseWithZod(formData, { schema: deleteUserSchema });

  if (submission.status !== "success") {
    return submission.reply({
      formErrors: ["user id is not defined."],
    });
  }

  try {
    await prisma.user.delete({
      where: { id: submission.value.id },
    });
  } catch (e) {
    if (e instanceof PrismaClientKnownRequestError) {
      switch (e.meta?.cause) {
        case "Record to delete does not exist.":
          return submission.reply({
            formErrors: ["user not found."],
          });
        default:
          return submission.reply({
            formErrors: ["something went wrong."],
          });
      }
    }
    throw e;
  }

  await setFlash({ type: "success", message: "user deleted." });
  await signOut();
  return submission.reply();
}
