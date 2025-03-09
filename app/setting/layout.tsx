import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SettingSidebar } from "@/app/ui/setting/setting-sidebar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <SettingSidebar />
      <main>
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
