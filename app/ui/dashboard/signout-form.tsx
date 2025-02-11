"use client";

import { PowerIcon } from "@heroicons/react/24/outline";
import { signOut } from "@/app/lib/actions";
import { loginEmailAtom, loginPasswordAtom } from "@/app/lib/atoms/atoms";
import { useSetAtom } from "jotai/react";
import { RESET } from "jotai/utils";
import { useEffect } from "react";

export default function SignOutForm() {
  const setEmail = useSetAtom(loginEmailAtom);
  const setPassword = useSetAtom(loginPasswordAtom);

  useEffect(() => {
    setEmail(RESET);
    setPassword(RESET);
  });

  return (
    <form action={signOut}>
      <button className="flex h-[48px] w-full grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3">
        <PowerIcon className="w-6" />
        <div className="hidden md:block">Sign Out</div>
      </button>
    </form>
  );
}
