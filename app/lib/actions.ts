"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatesCreateInvoice, validatesUpdateInvoice } from "./validates";
import { cookies } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { parseWithZod } from "@conform-to/zod";
import {
  credentialLoginSchema,
  emailLinkLoginSchema,
} from "./schema/login/schema";
import { signOut as SignOut } from "@/auth";
import { prisma } from "@/prisma";

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
  await SignOut({ redirectTo: "/" });
}

export async function authenticateWithGithub(
  redirectPath: string,
  _formData: FormData
) {
  try {
    await signIn("github", {
      redirectTo: redirectPath,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return redirect(`/?error=${e.type}`);
    }
    throw e;
  }
}

export async function authenticateWithEmailLink(
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

export async function authenticateWithCredential(
  redirectPath: string,
  _prevState: unknown,
  formData: FormData
) {
  const submission = parseWithZod(formData, { schema: credentialLoginSchema });

  if (submission.status !== "success") {
    return submission.reply();
  }

  try {
    await signIn("credentials", {
      email: submission.value.email,
      password: submission.value.password,
      redirectTo: redirectPath,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      switch (e.type) {
        case "CredentialsSignin":
          return submission.reply({
            formErrors: ["Invalid Credentials."],
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
  (await cookies()).set("successDeleteInvoice", "true", { maxAge: 0 });
  revalidatePath("/dashboard/invoices");
}
