import { cookies } from "next/headers";

export async function setFlash(flash: {
  type: "success" | "error";
  message: string;
}) {
  (await cookies()).set("flash", JSON.stringify(flash), {
    path: "/",
    maxAge: 0,
  });
}
