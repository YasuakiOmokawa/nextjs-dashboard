import { ReactNode } from "react";
import FormProvider from "../../ui/use-conform/create/form-provider";

export default async function Layout({ children }: { children: ReactNode }) {
  return <FormProvider>{children}</FormProvider>;
}
