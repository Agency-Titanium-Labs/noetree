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
import { FileText, Pin, Store } from "lucide-react";
import { NavMain, type NavMainItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";

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

  const isNotesActive = pathname === "/notes" || pathname === "/notes/";

  const isMarketplaceBrowseActive =
    pathname === "/marketplace" || pathname.startsWith("/marketplace/");

  const isListingsActive =
    pathname === "/listings" || pathname.startsWith("/listings/");

  const isPurchasesActive =
    pathname === "/purchases" || pathname.startsWith("/purchases/");

  const isSalesActive = pathname === "/sales" || pathname.startsWith("/sales/");

  const isMarketplaceActive =
    isMarketplaceBrowseActive ||
    isListingsActive ||
    isPurchasesActive ||
    isSalesActive;

  const navItems: NavMainItem[] = [
    {
      title: t("notes"),
      url: "/notes",
      icon: FileText,
      isActive: isNotesActive,
    },
    {
      title: t("marketplace"),
      url: "/marketplace",
      icon: Store,
      isActive: isMarketplaceActive,
      items: [
        {
          title: t("browse"),
          url: "/marketplace",
          isActive: isMarketplaceBrowseActive,
        },
        {
          title: t("listings"),
          url: "/listings",
          isActive: isListingsActive,
        },
        {
          title: t("purchases"),
          url: "/purchases",
          isActive: isPurchasesActive,
        },
        {
          title: t("sales"),
          url: "/sales",
          isActive: isSalesActive,
        },
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <NavMain
          label={t("title")}
          items={navItems}
          onItemClick={handleItemClick}
        />

        {pinnedTrees.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("pinned")}</SidebarGroupLabel>
            <SidebarMenu>
              {pinnedTrees.map(tree => (
                <SidebarMenuItem key={tree._id}>
                  <SidebarMenuButton
                    asChild
                    tooltip={tree.title}
                    isActive={pathname === `/notes/${tree._id}`}
                  >
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
