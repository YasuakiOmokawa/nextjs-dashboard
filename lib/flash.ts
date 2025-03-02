import { cookies } from "next/headers";

export type Flash = {
  type: "success" | "error";
  message: string;
};

export async function setFlash(flash: Flash) {
  (await cookies()).set("flash", JSON.stringify(flash), {
    path: "/",
    maxAge: 0,
  });
}
