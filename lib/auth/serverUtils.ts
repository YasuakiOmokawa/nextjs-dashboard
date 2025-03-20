"use server";

import { cookies } from "next/headers";

export async function setCustomCookie(key: string, value: string) {
  (await cookies()).set(key, value);
}

export async function getAndDeleteCookie(key: string) {
  const cookieList = await cookies();
  const value = cookieList.get(key)?.value;
  cookieList.delete(key);
  return value;
}
