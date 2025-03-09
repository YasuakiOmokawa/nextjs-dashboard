"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useActionState } from "react";
import { useSession } from "next-auth/react";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { userSchema } from "@/app/lib/schema/profile/schema";
import { updateUser } from "@/app/lib/actions";

export function EditForm() {
  const { data: session } = useSession();
  const [lastResult, action] = useActionState(
    updateUser.bind(null, String(session?.user?.id)),
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
    <form id={form.id} onSubmit={form.onSubmit} action={action} noValidate>
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>プロフィール編集</CardTitle>
          <CardDescription>情報を編集してください</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                type="email"
                key={fields.email.key}
                name={fields.email.name}
                defaultValue={
                  fields.email.value ?? String(session?.user?.email)
                }
                placeholder="sample@example.com"
              />
              <div className="text-red-500">{fields.email.errors}</div>
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                type="text"
                key={fields.name.key}
                name={fields.name.name}
                defaultValue={fields.name.value ?? String(session?.user?.name)}
                placeholder="John Doe"
              />
              <div className="text-red-500">{fields.name.errors}</div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button type="submit">Confirm</Button>
        </CardFooter>
      </Card>
    </form>
  );
}
