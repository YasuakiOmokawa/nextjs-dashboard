"use client";

import { useField } from "@conform-to/react";
// import { Button } from "../../button";

export default function Form() {
  // const form = useFormMetadata();
  const [email] = useField<string>("email");

  return (
    <>
      <div>please input confirmation</div>
      <div className="items-center">
        <div className="font-medium">{email.name}</div>
        <div>{email.value}</div>
      </div>
      {/* <form id={form.id} action={formAction}>
        {form.value && form.valid && (
          <Button type="submit">Go to Confirm</Button>
        )}
      </form> */}
    </>
  );
}
