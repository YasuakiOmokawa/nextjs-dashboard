"use client";

import { cn } from "@/lib/utils";
import GithubAuthForm from "@/app/ui/github-auth-form";
import AuthFormHeader from "./auth-form-header";
import MyServiceName from "./my-service-name";
import EmailLinkSignupForm from "@/app/ui/email-link-signup-form";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <AuthFormHeader />
          <h1 className="text-xl font-bold">
            <MyServiceName /> へ登録
          </h1>
          <div className="text-center text-sm">
            アカウントをお持ちの方は{" "}
            <a href="/login" className="underline underline-offset-4">
              こちら
            </a>
          </div>
        </div>
        <EmailLinkSignupForm />
        <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
          <span className="relative z-10 bg-background px-2 text-muted-foreground">
            Or
          </span>
        </div>
        <div className="grid gap-4">
          <GithubAuthForm />
        </div>
      </div>
      <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary  ">
        登録またはログインすることで、<a href="#">利用規約</a>または
        <a href="#">プライバシーポリシー</a>に同意したものとみなします。
      </div>
    </div>
  );
}
