"use client";

import { toast } from "sonner";

export function Notify({
  isSuccessDeleteInvoice,
}: {
  isSuccessDeleteInvoice: boolean;
}) {
  if (isSuccessDeleteInvoice) {
    toast.success("Delete invoice successfully.");
  }

  return <div></div>;
}
