"use client";

import { ReactNode, useEffect } from "react";
import { toast } from "sonner";

export function Notify({
  children,
  isSuccessDeleteInvoice,
}: {
  children: ReactNode;
  isSuccessDeleteInvoice: boolean;
}) {
  useEffect(() => {
    if (isSuccessDeleteInvoice) {
      toast.success("Delete invoice successfully.");
    }
  });

  return <>{children}</>;
}
