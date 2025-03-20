"use client";

import { GalleryVerticalEnd } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import githubIcon from "@/app/ui/icons/github-mark.png";
import Image from "next/image";
import { authenticateWithGithub } from "@/app/lib/actions";
import { useRedirectPath } from "@/app/lib/hooks/login/useRedirectPath";
import EmailLinkForm from "@/app/ui/email-link-form";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <a href="#" className="flex flex-col items-center gap-2 font-medium">
            <div className="flex h-8 w-8 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-6" />
            </div>
            <span className="sr-only">Acme Inc.</span>
          </a>
          <h1 className="text-xl font-bold">Welcome to Acme Inc.</h1>
          <div className="text-center text-sm">
            Don&apos;t have an account?{" "}
            <a href="#" className="underline underline-offset-4">
              Sign up
            </a>
          </div>
        </div>
        <EmailLinkForm />
        <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
          <span className="relative z-10 bg-background px-2 text-muted-foreground">
            Or
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <form action={authenticateWithGithub.bind(null, useRedirectPath())}>
            <Button variant="outline" className="w-full">
              <Image
                src={githubIcon}
                alt="GitHub icon for login"
                width={100}
                height={100}
                className="h-5 w-5"
              />
              Continue with GitHub
            </Button>
          </form>
        </div>
      </div>
      <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary  ">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </div>
    </div>
  );
}
