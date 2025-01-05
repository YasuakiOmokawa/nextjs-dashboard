"use client";

import { useField, useFormMetadata } from "@conform-to/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");
  const [name] = useField<string>("name");
  const { replace } = useRouter();

  useEffect(() => {
    if (form.status === "error") {
      replace("/use-conform");
    }
  });

  return (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Please check your input</CardTitle>
        <CardDescription>please submit if all acceptable</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="font-bold list-disc list-inside">
          <li>{`${email.name}: ${email.value}`}</li>
          <li>{`${name.name}: ${name.value}`}</li>
        </ul>
      </CardContent>
      <CardFooter>
        <form id={form.id} onSubmit={form.onSubmit} className="flex gap-8">
          <input type="hidden" name={email.name} value={email.value} />
          <input type="hidden" name={name.name} value={name.value} />
          <Link href="/use-conform">
            <Button variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" name="submitType" value="submit">
            Submit
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
