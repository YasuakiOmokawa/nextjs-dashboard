"use client";

import { useFormMetadata, useField } from "@conform-to/react";
import { Button } from "../button";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");

  return (
    <form id={form.id} onSubmit={form.onSubmit} noValidate>
      <div>
        <label>Email</label>
        <input
          type="email"
          key={email.key}
          name={email.name}
          defaultValue={email.initialValue}
        />
        <div className="text-red-500">{email.errors}</div>
      </div>
      <Button type="submit">Go to Confirm</Button>
    </form>
  );
}
