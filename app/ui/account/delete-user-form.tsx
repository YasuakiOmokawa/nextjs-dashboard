"use client";

import { deleteUser } from "@/app/lib/actions";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

export function DeleteUserForm() {
  const { data: session } = useSession();
  const handleClick = (e: React.FormEvent<HTMLFormElement>) => {
    if (confirm("本当によろしいですか？") === false) {
      e.preventDefault();
      return;
    }
  };

  return (
    <form
      action={deleteUser.bind(null, session?.user?.id)}
      onSubmit={handleClick}
    >
      <Button variant="destructive" type="submit">
        アカウントを削除します
      </Button>
    </form>
  );
}
