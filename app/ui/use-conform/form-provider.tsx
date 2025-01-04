"use client";

import { ReactNode, startTransition, useActionState } from "react";
import {
  FormProvider as ConformFormProvider,
  useForm,
} from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { schema } from "@/app/lib/use-conform/schema";
import { useRouter, usePathname } from "next/navigation";
import { confirm } from "@/app/lib/use-conform/action";

export default function FormProvider({ children }: { children: ReactNode }) {
  const [lastResult, formAction] = useActionState(confirm, undefined);
  const router = useRouter();
  const pathName = usePathname();

  const [form] = useForm({
    lastResult,
    defaultValue: {
      email: "",
    },
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: schema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
    onSubmit(event) {
      event.preventDefault();

      const submittedForm = event.currentTarget;
      const formPath = "/use-conform";
      const confirmPath = "/use-conform/confirm";

      switch (pathName) {
        case formPath:
          router.push(confirmPath);
          break;
        case confirmPath:
          const formData = new FormData(submittedForm);
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
