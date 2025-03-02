"use client";

import { ReactNode, useEffect } from "react";
import { toast } from "sonner";

export function Notify({
  children,
  isSuccessDeleteInvoice,
  isSuccessDeleteUser,
}: {
  children: ReactNode;
  isSuccessDeleteInvoice?: boolean;
  isSuccessDeleteUser?: boolean;
}) {
  useEffect(() => {
    if (isSuccessDeleteInvoice) {
      toast.success("Delete invoice successfully.");
    }
    if (isSuccessDeleteUser) {
      toast.success("Delete user successfully.");
    }
  });

  return <>{children}</>;
}
