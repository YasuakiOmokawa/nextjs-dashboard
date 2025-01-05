"use client";

import { useFormMetadata, useField } from "@conform-to/react";
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
import Link from "next/link";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");
  const [name] = useField<string>("name");

  return (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Form with conform</CardTitle>
        <CardDescription>Please input your info</CardDescription>
      </CardHeader>
      <CardContent>
        <form id={form.id} onSubmit={form.onSubmit} noValidate>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                type="email"
                key={email.key}
                name={email.name}
                defaultValue={email.value || email.initialValue}
                placeholder="sample@example.com"
              />
              <div className="text-red-500">{email.errors}</div>
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                type="text"
                key={name.key}
                name={name.name}
                defaultValue={name.value || name.initialValue}
                placeholder="John Doe"
              />
              <div className="text-red-500">{name.errors}</div>
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Link href="/">
          <Button variant="outline">Cancel</Button>
        </Link>
        <Button type="submit" name="submitType" value="confirm" form={form.id}>
          Confirm
        </Button>
      </CardFooter>
    </Card>
  );
}
