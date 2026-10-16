"use client";

import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/routing";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Home, FileText, Pin } from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";

const items = [
  {
    title: "dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "notes",
    url: "/notes",
    icon: FileText,
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpen, setOpenMobile, isMobile } = useSidebar();
  const lastPath = useRef("");
  const t = useTranslations("Sidebar");

  const { data: trees } = useQuery(convexQuery(api.notes.getTreesByMe, {}));
  const pinnedTrees = trees?.filter(t => t.isPinned).slice(0, 10) || [];

  const handleItemClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  useEffect(() => {
    if (lastPath.current !== pathname) {
      if (isMobile) {
        setOpenMobile(false);
      } else {
        const isEditorPage =
          pathname.startsWith("/notes/") &&
          pathname !== "/notes" &&
          pathname !== "/notes/";

        if (isEditorPage) {
          setOpen(false);
        }
      }
      lastPath.current = pathname;
    }
  }, [pathname, isMobile, setOpen, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("title")}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map(item => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={t(item.title)}>
                  <Link href={item.url} onClick={handleItemClick}>
                    <item.icon />
                    <span>{t(item.title)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {pinnedTrees.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("pinned")}</SidebarGroupLabel>
            <SidebarMenu>
              {pinnedTrees.map(tree => (
                <SidebarMenuItem key={tree._id}>
                  <SidebarMenuButton asChild tooltip={tree.title}>
                    <Link href={`/notes/${tree._id}`} onClick={handleItemClick}>
                      <Pin className="h-4 w-4 -rotate-45" />
                      <span className="truncate">{tree.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
