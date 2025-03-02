"use client";

import { ReactNode, useEffect } from "react";
import { toast } from "sonner";
import { Flash } from "@/lib/flash-toaster";

export function FlashToasterClient({
  flash,
  children,
}: {
  flash: string | undefined;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!!flash) {
      const data: Flash = JSON.parse(flash);
      switch (data.type) {
        case "success":
          toast.success(data.message);
          break;
        case "error":
          toast.error(data.message);
          break;
        default:
          break;
      }
    }
  });
  return children;
}
