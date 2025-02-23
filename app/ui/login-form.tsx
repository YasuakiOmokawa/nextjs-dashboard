"use client";

import { lusitana } from "@/app/ui/fonts";
import {
  AtSymbolIcon,
  ExclamationCircleIcon,
  KeyIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import { ArrowRightIcon } from "@heroicons/react/20/solid";
import { Button } from "./button";
import { useActionState } from "react";
import { authenticateWithCredential } from "../lib/actions";
import { useRedirectPath } from "../lib/hooks/login/useRedirectPath";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { loginSchema } from "../lib/schema/login/schema";
import Link from "next/link";

export default function LoginForm() {
  const [lastResult, action] = useActionState(
    authenticateWithCredential.bind(null, useRedirectPath()),
    undefined
  );
  const [form, fields] = useForm({
    lastResult,

    onValidate({ formData }) {
      return parseWithZod(formData, { schema: loginSchema });
    },

    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <form
      id={form.id}
      onSubmit={form.onSubmit}
      action={action}
      noValidate
      className="space-y-3"
    >
      <div className="flex-1 rounded-lg bg-gray-50 px-6 pb-4 pt-8">
        <h1 className={`${lusitana.className} mb-3 text-2xl`}>
          Please log in to continue.
        </h1>
        <div className="w-full">
          <div>
            <label
              className="mb-3 mt-5 block text-xs font-medium text-gray-900"
              htmlFor="email"
            >
              Email
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                key={fields.email.key}
                type="email"
                name={fields.email.name}
                placeholder="Enter your email address"
                defaultValue={fields.email.value}
              />
              <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
            <div className="text-red-500">{fields.email.errors}</div>
          </div>
          <div className="mt-4">
            <label
              className="mb-3 mt-5 block text-xs font-medium text-gray-900"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                key={fields.password.key}
                type="password"
                name={fields.password.name}
                placeholder="Enter password"
                defaultValue={fields.password.value}
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
            <div className="text-red-500">{fields.password.errors}</div>
          </div>
        </div>
        <Button className="mt-4 w-full">
          Log in <ArrowRightIcon className="ml-auto h-5 w-5 text-gray-50" />
        </Button>
        <div
          className="flex h-8 items-end space-x-1"
          aria-live="polite"
          aria-atomic="true"
        >
          {form.errors && (
            <>
              <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
              <p className="text-sm text-red-500">{form.errors}</p>
            </>
          )}
        </div>
        <div className="flex items-center">
          <div className="flex-grow h-px bg-black"></div>
          <div className="px-4">or</div>
          <div className="flex-grow h-px bg-black"></div>
        </div>{" "}
        <Link href="/login/email">
          <Button className="mt-4 w-full">
            <EnvelopeIcon className="mr-1.5 h-5 w-5 text-gray-50" />
            Log in with Email Link
          </Button>
        </Link>
      </div>
    </form>
  );
}
