"use client";

import { useFormMetadata, useField } from "@conform-to/react";
import { Button } from "../button";

export default function Form() {
  const form = useFormMetadata();
  const [email] = useField<string>("email");
  const [message] = useField<string>("message");

  return (
    <form id={form.id} onSubmit={form.onSubmit} noValidate>
      <div>
        <fieldset>
          <label>Email</label>
          <input
            type="email"
            key={email.key}
            name={email.name}
            defaultValue={email.initialValue}
          />
          <div className="text-red-500">{email.errors}</div>
        </fieldset>
        <fieldset className="mt-2">
          <label>Message</label>
          <input
            type="text"
            key={message.key}
            name={message.name}
            defaultValue={message.initialValue}
          />
          <div className="text-red-500">{message.errors}</div>
        </fieldset>
      </div>
      <div className="mt-6 flex">
        <Button type="submit" name="submitType" value="confirm">
          Confirm
        </Button>
      </div>
    </form>
  );
}
