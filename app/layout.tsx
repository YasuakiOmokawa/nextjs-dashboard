import "@/app/ui/global.css";
import { inter } from "@/app/ui/fonts";
import FlashToaster from "@/lib/flash-toaster";
import { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SessionProvider>
      <html lang="en">
        <body className={`${inter.className} antialiased`}>
          {children}
          <FlashToaster />
        </body>
      </html>
    </SessionProvider>
  );
}
