"use client";

import { cn } from "@/lib/utils";
import GithubAuthForm from "@/app/ui/github-auth-form";
import AuthFormHeader from "./auth-form-header";
import MyServiceName from "./my-service-name";
import Link from "next/link";
import EmailLinkLoginForm from "@/app/ui/email-link-login-form";
import AuthFormFooter from "./auth-form-footer";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <AuthFormHeader />
          <h1 className="text-xl font-bold">
            <MyServiceName /> へログイン
          </h1>
          <div className="text-center text-sm">
            アカウントをお持ちでない方は{" "}
            <Link href="/signup" className="underline underline-offset-4">
              こちら
            </Link>
          </div>
        </div>
        <EmailLinkLoginForm />
        <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
          <span className="relative z-10 bg-background px-2 text-muted-foreground">
            Or
          </span>
        </div>
        <div className="grid gap-4">
          <GithubAuthForm />
        </div>
      </div>
      <AuthFormFooter />
    </div>
  );
}
