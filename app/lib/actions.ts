"use server";

import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const prisma = new PrismaClient();

const FormSchema = z.object({
  id: z.string(),
  amount: z.coerce.number().gt(0, "Please enter an amount greater than $0."),
  status: z.enum(["paid", "pending"], {
    invalid_type_error: "Please select an invoice status.",
  }),
  date: z.date(),
  customerId: z.string({
    invalid_type_error: "Please select a customer.",
  }),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });

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
  const validatedFields = CreateInvoice.safeParse(rawFormData); // Validate fields using Zod

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
        amount: amountInCents,
        status: status,
        customer_id: customerId,
      },
    });
  } catch (e) {
    return {
      message: "Database Error: Failed to create invoice.",
    };
  }

  revalidatePath("/dashboard/invoices"); // update page cache
  redirect("/dashboard/invoices");
}

const UpdateInvoice = FormSchema.omit({ id: true, date: true });

export async function updateInvoice(id: string, formData: FormData) {
  const rawFormData = Object.fromEntries(formData.entries());
  const { customerId, amount, status } = UpdateInvoice.parse(rawFormData);

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
  } catch (e) {
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
  } catch (e) {
    return {
      message: "Failed to delete invoice.",
    };
  }
}
