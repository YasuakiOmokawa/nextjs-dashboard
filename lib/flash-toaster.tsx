import { Toaster } from "@/components/ui/sonner";
import { cookies } from "next/headers";
import { FlashToasterClient } from "./flash-toaster/flash-toaster-client";

export type Flash = {
  type: "success" | "error";
  message: string;
};

export async function setFlash(flash: Flash) {
  (await cookies()).set("flash", JSON.stringify(flash), {
    path: "/",
    maxAge: 1,
  });
}

export default async function FlashToaster() {
  const flash = (await cookies()).get("flash");

  return (
    <FlashToasterClient flash={flash?.value}>
      <Toaster />
    </FlashToasterClient>
  );
}
