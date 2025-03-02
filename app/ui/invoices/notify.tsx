"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Flash } from "@/lib/flash";

export function Notify({ flash }: { flash: string | undefined }) {
  useEffect(() => {
    if (!!flash) {
      const data: Flash = JSON.parse(flash);
      if (data.type === "success") {
        toast.success(data.message);
      } else if (data.type === "error") {
        toast.error(data.message);
      }
    }
  });
  return <Toaster />;
}
