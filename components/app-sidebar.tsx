"use client";

import * as React from "react";
import { Command } from "lucide-react";
import { BanknotesIcon } from "@heroicons/react/24/outline";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSession } from "next-auth/react";
import Link from "next/link";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const data = {
    user: {
      name: session?.user?.name ?? "",
      email: session?.user?.email ?? "",
      avatar: session?.user?.image ?? "",
    },
    navMain: [
      {
        title: "ダッシュボード",
        url: "/dashboard",
        icon: BanknotesIcon,
        isActive: true,
        items: [
          {
            title: "請求書",
            url: "/dashboard/invoices",
          },
          {
            title: "顧客リスト",
            url: "/dashboard/customers",
          },
        ],
      },
    ],
  };

  return (
    <Sidebar
      className="top-[--header-height] !h-[calc(100svh-var(--header-height))]"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">FBO Inc</span>
                  <span className="truncate text-xs">Trial Plan</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
