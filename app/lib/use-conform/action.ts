"use server";

import { parseWithZod } from "@conform-to/zod";
import { schema } from "./schema";
import { redirect } from "next/navigation";

export async function createData(_prevState: unknown, formData: FormData) {
  const submission = parseWithZod(formData, {
    schema: schema,
  });

  if (submission.status !== "success") {
    return submission.reply();
  }

  // please implement server query
  console.log("data creation success!");

  redirect("/thanks");
}
