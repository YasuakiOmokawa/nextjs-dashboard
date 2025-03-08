"use client";

import { updateUser } from "@/app/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActionState } from "react";
import { useSession } from "next-auth/react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { userSchema } from "@/app/lib/schema/profile/schema";

export function EditSheet() {
  const { data: session } = useSession();
  const [lastResult, action] = useActionState(
    updateUser.bind(null, session?.user?.id),
    undefined
  );
  const [form, fields] = useForm({
    lastResult,

    onValidate({ formData }) {
      return parseWithZod(formData, { schema: userSchema });
    },

    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Update Profile</Button>
      </SheetTrigger>
      <SheetContent>
        <form id={form.id} onSubmit={form.onSubmit} action={action} noValidate>
          <SheetHeader>
            <SheetTitle>Edit profile</SheetTitle>
            <SheetDescription>アカウント情報を編集します</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                key={fields.name.key}
                name={fields.name.name}
                defaultValue={fields.name.value ?? String(session?.user?.name)}
                className="col-span-3"
              />
            </div>
            <div className="text-red-500">{fields.name.errors}</div>
          </div>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="submit">更新</Button>
            </SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
