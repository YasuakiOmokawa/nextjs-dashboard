"use server";

import { parseWithZod } from "@conform-to/zod";
import { schema } from "./schema";
import { redirect } from "next/navigation";

export async function confirm(_prevState: unknown, formData: FormData) {
  const submission = parseWithZod(formData, {
    schema: schema,
  });

  if (submission.status !== "success") {
    return submission.reply();
  }

  redirect("/dashboard");
}
