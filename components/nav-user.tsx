"use client";

import {
  ChevronsUpDown,
  Globe,
  Laptop,
  LogOut,
  Moon,
  Settings,
  Sun,
  User,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter, usePathname } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";

export function NavUser() {
  const { isMobile } = useSidebar();
  const { user, isLoaded } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const t = useTranslations("NavUser");

  if (!isLoaded || !user) {
    return null;
  }

  const name = user.fullName || user.username || "";
  const email = user.primaryEmailAddress?.emailAddress || "";
  const avatar = user.imageUrl || "";

  const onLocaleChange = (nextLocale: "en" | "fr") => {
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              tooltip={name}
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={avatar} alt={name} />
                <AvatarFallback className="rounded-lg">
                  {name ? name.slice(0, 2).toUpperCase() : "US"}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs">{email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={avatar} alt={name} />
                  <AvatarFallback className="rounded-lg">
                    {name ? name.slice(0, 2).toUpperCase() : "NT"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs">{email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings />
                {t("settings")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openUserProfile()}>
                <User />
                {t("account")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Globe />
                  <span>{t("language")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onClick={() => onLocaleChange("fr")}
                      disabled={currentLocale === "fr"}
                    >
                      Français {currentLocale === "fr" && "✓"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onLocaleChange("en")}
                      disabled={currentLocale === "en"}
                    >
                      English {currentLocale === "en" && "✓"}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Sun className="dark:hidden" />
                  <Moon className="hidden dark:block" />
                  <span>{t("theme")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      onClick={() => setTheme("light")}
                      disabled={theme === "light"}
                    >
                      <Sun />
                      <span>{t("themeLight")}</span> {theme === "light" && "✓"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("dark")}
                      disabled={theme === "dark"}
                    >
                      <Moon />
                      <span>{t("themeDark")}</span> {theme === "dark" && "✓"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setTheme("system")}
                      disabled={theme === "system"}
                    >
                      <Laptop />
                      <span>{t("themeSystem")}</span>{" "}
                      {theme === "system" && "✓"}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
