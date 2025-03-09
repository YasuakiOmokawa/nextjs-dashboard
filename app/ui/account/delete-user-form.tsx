"use client";

import { deleteUser } from "@/app/lib/actions";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

export function DeleteUserForm() {
  const { data: session } = useSession();
  const handleClick = (event) => {
    event.preventDefault();
    if (confirm("本当によろしいですか？")) {
      event.target.closest('form').submit();
    }
  };
  return (
    <form action={deleteUser.bind(null, session?.user?.id)}>
      <Button variant="destructive" onClick={handleClick}>
        アカウントを削除します
      </Button>
    </form>
  );
}
