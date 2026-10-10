import type { ReactNode } from "react";

export default function CardMessage({ children }: { children: ReactNode }) {
  return (
    <p className="px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
