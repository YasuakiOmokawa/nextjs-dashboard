"use server";

import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatesCreateInvoice, validatesUpdateInvoice } from "./validates";
import { cookies } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";

const prisma = new PrismaClient();

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

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData
) {
  try {
    await signIn("credentials", formData);
  } catch (e) {
    if (e instanceof AuthError) {
      switch (e.type) {
        case "CredentialsSignin":
          return "Invalid Credentials.";
        default:
          return "Something went wrong.";
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
