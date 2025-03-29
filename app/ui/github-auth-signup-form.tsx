"use client";

import { Button } from "@/components/ui/button";
import githubIcon from "@/app/ui/icons/github-mark.png";
import Image from "next/image";
import { loginWithGithub } from "@/app/lib/actions";
import { useRedirectPath } from "@/app/lib/hooks/login/useRedirectPath";

export default function GithubAuthSignupForm() {
  return (
    <form action={loginWithGithub.bind(null, useRedirectPath())}>
      <Button variant="outline" className="w-full">
        <Image
          src={githubIcon}
          alt="GitHub icon for signup"
          width={100}
          height={100}
          className="h-5 w-5"
        />
        GitHub で登録
      </Button>
    </form>
  );
}
