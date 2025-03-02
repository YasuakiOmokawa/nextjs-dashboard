import "@/app/ui/global.css";
import { inter } from "@/app/ui/fonts";
import { Toaster } from "@/components/ui/sonner";
import { Notify } from "./ui/invoices/notify";
import { cookies } from "next/headers";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const flash = (await cookies()).get("flash");

  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        {children}
        <Notify flash={flash?.value} />
        <Toaster />
      </body>
    </html>
  );
}
