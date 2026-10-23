"use client";

import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useStoreUserEffect } from "@/hooks/useStoreUserEffect";
import { useRouter } from "@/i18n/routing";
import { getInitials } from "@/lib/initials";
import { formatFullDate, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationBell() {
  const t = useTranslations("Notifications");
  const locale = useLocale();
  const router = useRouter();
  const { isAuthenticated } = useStoreUserEffect();
  const [open, setOpen] = useState(false);

  const { data: unreadData } = useQuery({
    ...convexQuery(api.notifications.unreadCount, {}),
    enabled: isAuthenticated,
  });
  const unread = unreadData ?? 0;

  const { data: items, isPending } = useQuery({
    ...convexQuery(api.notifications.list, {}),
    enabled: isAuthenticated && open,
  });

  const markRead = useConvexMutation(api.notifications.markRead);
  const markAllRead = useConvexMutation(api.notifications.markAllRead);

  async function handleClick(item: NonNullable<typeof items>[number]) {
    if (!item.isRead) {
      try {
        await markRead({ notificationId: item._id as Id<"notifications"> });
      } catch {
        // best effort: navigation still proceeds
      }
    }
    setOpen(false);
    const path =
      item.href.kind === "app"
        ? `/notes/${item.href.noteId}`
        : `/p/${item.href.noteId}`;
    router.push(`${path}?comments=1&c=${item.href.commentId}`);
  }

  async function handleMarkAll() {
    try {
      await markAllRead({});
    } catch {
      // ignore
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-11 min-w-11 md:min-h-9 md:min-w-9"
          aria-label={t("bellAria", { count: unread })}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -top-1 -right-1 flex h-4 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
            >
              {unread >= 100 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex items-center justify-between px-4 py-4">
          <h3 className="text-base font-semibold">{t("title")}</h3>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={handleMarkAll}
          >
            <CheckCheck className="size-4" />
            {t("markAllRead")}
          </Button>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {isPending ? (
            <div className="space-y-2 px-4 pb-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !items || items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold">{t("emptyHeading")}</p>
              <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
            </div>
          ) : (
            items.map(item => (
              <button
                key={item._id}
                type="button"
                onClick={() => handleClick(item)}
                className={cn(
                  "flex w-full gap-2 px-4 py-4 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  !item.isRead && "bg-accent",
                )}
              >
                <Avatar className="size-8 shrink-0">
                  {item.actor.avatarUrl && (
                    <AvatarImage src={item.actor.avatarUrl} alt="" />
                  )}
                  <AvatarFallback>
                    {getInitials(item.actor.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {t.rich(
                      item.kind === "reply" ? "textReply" : "textComment",
                      {
                        actor: item.actor.name ?? t("unknownActor"),
                        title: item.noteTitle,
                        b: chunks => (
                          <span className="font-semibold">{chunks}</span>
                        ),
                      },
                    )}
                  </p>
                  <p
                    className="text-xs text-muted-foreground"
                    title={formatFullDate(item._creationTime, locale)}
                  >
                    {formatRelativeTime(item._creationTime, locale)}
                  </p>
                </div>
                {!item.isRead && (
                  <>
                    <span
                      aria-hidden="true"
                      className="mt-1 size-2 shrink-0 rounded-full bg-primary"
                    />
                    <span className="sr-only">{t("unread")}</span>
                  </>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
