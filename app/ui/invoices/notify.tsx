"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function Notify({
  isSuccessDeleteInvoice,
}: {
  isSuccessDeleteInvoice: boolean;
}) {
  useEffect(() => {
    if (isSuccessDeleteInvoice) {
      toast.success("Delete invoice successfully.");
    }
  });

  return <p className="sr-only">notify</p>;
}
