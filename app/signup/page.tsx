import { SignUpForm } from "@/components/signup-form";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
    </div>
  );
}
