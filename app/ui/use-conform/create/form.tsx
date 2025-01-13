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
import { useLocationState } from "@location-state/core";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");
  const [name] = useField<string>("name");
  const [emailState, setEmail] = useLocationState({
    name: "email",
    defaultValue: email.value,
    storeName: "session",
  });
  const [nameState, setName] = useLocationState({
    name: "name",
    defaultValue: name.value,
    storeName: "session",
  });

  return (
    <form id={form.id} onSubmit={form.onSubmit} noValidate>
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>Form with Conform</CardTitle>
          <CardDescription>Please input your info</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                type="email"
                key={email.key}
                name={email.name}
                defaultValue={emailState}
                placeholder="sample@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="text-red-500">{email.errors}</div>
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                type="text"
                key={name.key}
                name={name.name}
                defaultValue={nameState}
                placeholder="John Doe"
                onChange={(e) => setName(e.target.value)}
              />
              <div className="text-red-500">{name.errors}</div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Link href="/">
            <Button variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" name="intent" value="confirm">
            Confirm
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
