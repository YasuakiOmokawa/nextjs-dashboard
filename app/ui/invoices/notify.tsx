"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function Notify({ flash }: { flash: string | undefined }) {
  useEffect(() => {
    if (!!flash) {
      const { type, message } = JSON.parse(flash);
      if (type === "success") {
        toast.success(message);
      } else if (type === "error") {
        toast.error(message);
      }
    }
  });
  return null;
}
