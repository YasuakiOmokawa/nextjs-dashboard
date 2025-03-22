"use client";

import * as React from "react";
import { Command } from "lucide-react";
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
import { Cog6ToothIcon, UserIcon } from "@heroicons/react/24/outline";
import { NavProjects } from "./nav-projects";

export function SettingSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const data = {
    user: {
      name: session?.user?.name ?? "",
      email: session?.user?.email ?? "",
      avatar: session?.user?.image ?? "",
    },
    projects: [
      {
        name: "プロフィール",
        url: "/setting/profile",
        icon: UserIcon,
      },
      {
        name: "アカウント",
        url: "/setting/account",
        icon: Cog6ToothIcon,
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
        <NavProjects title="基本設定" projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
