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

  await prisma.invoices.create({
    data: {
      amount: amountInCents,
      status: status,
      customer_id: customerId,
    },
  });

  revalidatePath("/dashboard/invoices");
  redirect("/dashboard/invoices");
}
