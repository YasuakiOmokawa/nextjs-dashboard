import { SidebarProvider } from "@/components/ui/sidebar";
import { SettingSidebar } from "@/app/ui/setting/setting-sidebar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <main>
        <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
          <SettingSidebar />
          {children}
        </div>
      </main>
    </SidebarProvider>
  );
}
