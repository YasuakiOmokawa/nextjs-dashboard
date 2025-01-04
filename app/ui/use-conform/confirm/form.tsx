"use client";

import { useField, useFormMetadata } from "@conform-to/react";
import { Button } from "../../button";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");

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
        {form.value && form.valid && <Button type="submit">Submit</Button>}
      </form>
    </>
  );
}
