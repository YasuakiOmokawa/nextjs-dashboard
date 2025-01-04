"use client";

import { useField, useFormMetadata } from "@conform-to/react";
import { Button } from "../../button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");
  const { replace } = useRouter();

  useEffect(() => {
    if (form.status === "error") {
      replace("/use-conform");
    }
  });

  return (
    <>
      <div>please check your input</div>
      <div className="items-center">
        <div className="font-medium">{`${email.name}: ${email.value}`}</div>
      </div>
      <form id={form.id} onSubmit={form.onSubmit}>
        <input
          hidden
          type="email"
          key={email.key}
          name={email.name}
          defaultValue={email.value}
        />
        <Button type="submit">Submit</Button>
      </form>
    </>
  );
}
