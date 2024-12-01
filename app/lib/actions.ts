"use server";

import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const prisma = new PrismaClient();

const FormSchema = z.object({
  id: z.string(),
  amount: z.coerce.number(),
  status: z.enum(["paid", "pending"]),
  date: z.date(),
  customerId: z.string(),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });

export async function createInvoice(formData: FormData) {
  const rawFormData = Object.fromEntries(formData.entries());
  const { customerId, amount, status } = CreateInvoice.parse(rawFormData);

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
    console.error("Database Error:", e);
    return {
      message: "Failed to create invoice.",
    };
  }

  revalidatePath("/dashboard/invoices");
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
    console.error("Database Error:", e);
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
    console.error("Database Error:", e);
    return {
      message: "Failed to delete invoice.",
    };
  }
}
