"use client";

import { deleteUser } from "@/app/lib/actions";
import { Button } from "@/components/ui/button";
import { withCallbacks } from "@/lib/with-callbacks";
import { useSession } from "next-auth/react";
import { useActionState } from "react";
import { toast } from "sonner";

export function DeleteUserForm() {
  const { data: session } = useSession();
  const handleClick = (e: React.FormEvent<HTMLFormElement>) => {
    if (confirm("本当によろしいですか？") === false) {
      e.preventDefault();
      return;
    }
  };

  const [_lastResult, action] = useActionState(
    withCallbacks(deleteUser.bind(null, session?.user?.id), {
      onError(result) {
        if (result.error) {
          const message = result.error[""];
          toast.error(message?.at(0), {
            duration: 10000,
          });
        }
      },
    }),
    undefined
  );

  return (
    <form action={action} onSubmit={handleClick}>
      <Button variant="destructive" type="submit">
        アカウントを削除します
      </Button>
    </form>
  );
}
