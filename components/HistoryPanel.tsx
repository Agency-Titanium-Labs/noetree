"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useConvex } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import SharedUnavailable from "@/components/SharedUnavailable";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { historyErrorMessage } from "@/components/VersionPreviewBanner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Link } from "@/i18n/routing";
import { getInitials } from "@/lib/initials";
import { cn } from "@/lib/utils";
import { useEditorContext } from "@/providers/EditorProvider";

const PAGE_SIZE = 30;

type VersionRow = {
  _id: Id<"noteVersions">;
  createdAt: number;
  isPreRestore: boolean;
  author: { name: string | null; avatarUrl: string | null } | null;
};

type ListPage = {
  versions: VersionRow[];
  hasMore: boolean;
  continueCursor: string;
  hasHidden: boolean;
};

function SkeletonRow() {
  return (
    <div className="flex gap-2">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}

export default function HistoryPanel({
  noteId,
  open,
  onOpenChange,
}: Readonly<{
  noteId: Id<"notes">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const t = useTranslations("History");
  const locale = useLocale();
  const convex = useConvex();
  const { previewVersion, enterPreview, exitPreview } = useEditorContext();
  const [cursorState, setCursorState] = useState<{
    noteId: Id<"notes">;
    cursors: (string | null)[];
  }>({ noteId, cursors: [null] });
  const cursors = cursorState.noteId === noteId ? cursorState.cursors : [null];

  const pages = useQueries({
    queries: cursors.map(cursor => ({
      ...convexQuery(api.noteVersions.list, {
        noteId,
        cursor,
        numItems: PAGE_SIZE,
      }),
      enabled: open,
    })),
  });

  const first = pages[0];
  const last = pages[pages.length - 1];
  const anyNull = pages.some(p => p.data === null);
  const firstData = first?.data as ListPage | null | undefined;
  const lastData = last?.data as ListPage | null | undefined;

  const versions = useMemo(() => {
    const seen = new Set<string>();
    const out: VersionRow[] = [];
    for (const p of pages) {
      const d = p.data as ListPage | null | undefined;
      for (const v of d?.versions ?? []) {
        if (seen.has(v._id)) continue;
        seen.add(v._id);
        out.push(v);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.map(p => p.data)]);

  const isNull = anyNull;
  const isLoading = !isNull && (first?.isPending || firstData === undefined);

  useEffect(() => {
    if (isNull && previewVersion) exitPreview();
  }, [isNull, previewVersion, exitPreview]);

  const groups = useMemo(() => {
    const result: { key: string; date: Date; rows: VersionRow[] }[] = [];
    for (const v of versions) {
      const date = new Date(v.createdAt);
      const key = date.toDateString();
      const g = result[result.length - 1];
      if (g && g.key === key) g.rows.push(v);
      else result.push({ key, date, rows: [v] });
    }
    return result;
  }, [versions]);

  const dayLabel = (date: Date, key: string) => {
    const now = new Date();
    if (key === now.toDateString()) return t("today");
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (key === yesterday.toDateString()) return t("yesterday");
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  };

  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const onSelect = async (versionId: Id<"noteVersions">) => {
    try {
      const v = await convex.query(api.noteVersions.get, { versionId });
      if (!v) {
        toast.error(t("errorLoad"));
        return;
      }
      enterPreview({
        _id: v._id,
        content: v.content,
        title: v.title,
        createdAt: v.createdAt,
        isPreRestore: v.isPreRestore,
        author: v.author,
      });
      if (window.matchMedia("(max-width: 639px)").matches) {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(historyErrorMessage(err, t, "errorLoad"));
    }
  };

  const onShowMore = () => {
    if (!lastData) return;
    setCursorState({
      noteId,
      cursors: [...cursors, lastData.continueCursor],
    });
  };

  let body;
  if (isNull) {
    body = <SharedUnavailable />;
  } else if (isLoading) {
    body = (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  } else if (versions.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <h3 className="text-base font-semibold">{t("emptyHeading")}</h3>
        <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
      </div>
    );
  } else {
    body = (
      <>
        {groups.map(group => (
          <section key={group.key} className="flex flex-col gap-1">
            <h3 className="sticky top-0 bg-background text-sm font-semibold text-muted-foreground">
              {dayLabel(group.date, group.key)}
            </h3>
            {group.rows.map(v => {
              const selected = previewVersion?._id === v._id;
              return (
                <button
                  key={v._id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void onSelect(v._id)}
                  className={cn(
                    "relative flex min-h-11 w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9",
                    selected && "bg-muted",
                  )}
                >
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-0.5 bg-primary"
                    />
                  )}
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {timeFormat.format(new Date(v.createdAt))}
                    </span>
                    {v.isPreRestore && (
                      <Badge variant="secondary">{t("beforeRestore")}</Badge>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar className="size-6">
                      {v.author?.avatarUrl ? (
                        <AvatarImage src={v.author.avatarUrl} alt="" />
                      ) : null}
                      <AvatarFallback>
                        {getInitials(v.author?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm">
                      {v.author?.name ?? t("unknownAuthor")}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {lastData?.hasMore && (
          <Button
            type="button"
            variant="ghost"
            disabled={last.isPending}
            onClick={onShowMore}
          >
            {t("showMore")}
          </Button>
        )}
        {firstData?.hasHidden && (
          <div className="rounded-md bg-muted px-4 py-2 text-sm">
            {t("hintOlderVersions")}{" "}
            <Link href="/pricing" className="text-primary underline">
              {t("upgradeLink")}
            </Link>
          </div>
        )}
      </>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="px-4 py-6">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("description")}
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <div
          aria-live="polite"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
        >
          {body}
        </div>
      </SheetContent>
    </Sheet>
  );
}
