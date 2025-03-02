import "@/app/ui/global.css";
import { inter } from "@/app/ui/fonts";
import FlashToaster from "@/lib/flash-toaster";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        {children}
        <FlashToaster />
      </body>
    </html>
  );
}
