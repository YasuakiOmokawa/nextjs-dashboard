"use server";

import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatesCreateInvoice, validatesUpdateInvoice } from "./validates";

const prisma = new PrismaClient();

// for useActionState
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

  try {
    await prisma.invoices.create({
      data: {
        customer_id: customerId,
        amount: amountInCents,
        status: status,
      },
    });
  } catch (_e) {
    return {
      message: "Database Error: Failed to create invoice.",
    };
  }

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

  try {
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
  } catch (_e) {
    return {
      message: "Failed to update invoice.",
    };
  }

  revalidatePath("/dashboard/invoices");
  redirect("/dashboard/invoices");
}

export async function deleteInvoice(id: string) {
  try {
    await prisma.invoices.delete({
      where: { id: id },
    });
    revalidatePath("/dashboard/invoices");
    return {
      message: "Delete invoice.",
    };
  } catch (_e) {
    return {
      message: "Failed to delete invoice.",
    };
  }
}
