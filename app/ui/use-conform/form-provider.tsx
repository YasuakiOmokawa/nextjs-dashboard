"use client";

import { ReactNode } from "react";
import {
  FormProvider as ConformFormProvider,
  useForm,
} from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { schema } from "@/app/lib/use-conform/schema";
import { useRouter } from "next/navigation";

export default function FormProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [form] = useForm({
    defaultValue: {
      email: "",
    },
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: schema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
    onSubmit(ev) {
      ev.preventDefault();
      router.push("/use-conform/confirm");
    },
  });

  return (
    <ConformFormProvider context={form.context}>{children}</ConformFormProvider>
  );
}
