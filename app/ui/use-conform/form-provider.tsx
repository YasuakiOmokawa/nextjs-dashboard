"use client";

import { ReactNode, startTransition, useActionState } from "react";
import {
  FormProvider as ConformFormProvider,
  useForm,
} from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { schema } from "@/app/lib/use-conform/schema";
import { useRouter } from "next/navigation";
import { createData } from "@/app/lib/use-conform/action";

export default function FormProvider({ children }: { children: ReactNode }) {
  const [lastResult, formAction] = useActionState(createData, undefined);
  const router = useRouter();
  const [form] = useForm({
    lastResult,
    defaultValue: {
      email: "",
      name: "",
    },
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: schema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
    onSubmit(event, { formData }) {
      event.preventDefault();

      switch (formData.get("submitType")) {
        case "confirm":
          router.push("/use-conform/confirm");
          break;
        case "submit":
          startTransition(() => {
            formAction(formData);
          });
          break;
        default:
          break;
      }
    },
  });

  return (
    <ConformFormProvider context={form.context}>{children}</ConformFormProvider>
  );
}
