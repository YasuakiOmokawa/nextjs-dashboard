"use client";

import { useField, useFormMetadata } from "@conform-to/react";
import { Button } from "../../button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

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
    <div className="p-5">
      <p>please check your input</p>
      <div className="mt-4">
        <ul className="font-bold list-inside list-disc">
          <li>{`${email.name}: ${email.value}`}</li>
          <li>{`${name.name}: ${name.value}`}</li>
        </ul>
      </div>
      <form id={form.id} onSubmit={form.onSubmit}>
        <input type="hidden" name={email.name} value={email.value} />
        <input type="hidden" name={name.name} value={name.value} />
        <div className="mt-6 flex gap-4">
          <Link
            href="/use-conform"
            className="flex h-10 items-center rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
          >
            Cancel
          </Link>
          <Button type="submit" name="submitType" value="submit">
            Submit
          </Button>
        </div>
      </form>
    </div>
  );
}
