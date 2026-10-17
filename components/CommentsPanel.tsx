"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { SignInButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

import CommentComposer, {
  type CommentTarget,
} from "@/components/CommentComposer";
import CommentThread from "@/components/CommentThread";
import SharedUnavailable from "@/components/SharedUnavailable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import { useStoreUserEffect } from "@/hooks/useStoreUserEffect";

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

export default function CommentsPanel({
  target,
  open,
  onOpenChange,
  focusCommentId,
}: Readonly<{
  target: CommentTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusCommentId?: string | null;
}>) {
  const t = useTranslations("Comments");
  const { isAuthenticated } = useStoreUserEffect();
  const [showResolved, setShowResolved] = useState(false);
  const [href, setHref] = useState("");
  const { data, isPending } = useQuery({
    ...convexQuery(api.comments.list, { target }),
    enabled: open,
  });

  useEffect(() => {
    setHref(window.location.href);
  }, []);

  const canComment = isAuthenticated && !!data && data.canComment;
  const openCount = data
    ? data.threads.filter(th => th.resolvedAt === null).length
    : 0;
  const hasThreads = !!data && data.threads.length > 0;
  const allResolved =
    hasThreads && data.threads.every(th => th.resolvedAt !== null);

  let body;
  if (data === null) {
    body = <SharedUnavailable />;
  } else if (isPending || data === undefined) {
    body = (
      <>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  } else if (!hasThreads) {
    body = (
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <h3 className="text-base font-semibold">{t("emptyHeading")}</h3>
        <p className="text-sm text-muted-foreground">
          {t(data.canComment ? "emptyBodySignedIn" : "emptyBodyAnonymous")}
        </p>
      </div>
    );
  } else {
    body = (
      <>
        {allResolved && !showResolved && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("emptyAllResolved")}
          </p>
        )}
        {data.threads.map(thread => (
          <CommentThread
            key={thread.root._id}
            target={target}
            thread={thread}
            canComment={canComment}
            showResolved={showResolved}
            focusCommentId={focusCommentId}
          />
        ))}
      </>
    );
  }

  let footer = null;
  if (data !== null) {
    if (isAuthenticated && data?.canComment) {
      footer = <CommentComposer target={target} />;
    } else if (!isAuthenticated) {
      footer = (
        <Card className="items-center gap-2 bg-muted p-4 text-center">
          <p className="text-sm font-semibold">{t("signInPrompt")}</p>
          {href && (
            <SignInButton mode="modal" forceRedirectUrl={href}>
              <Button variant="outline">{t("signInCta")}</Button>
            </SignInButton>
          )}
        </Card>
      );
    } else if (data === undefined || isPending) {
      footer = <Skeleton className="h-24 w-full" />;
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="px-4 py-6">
          <SheetTitle>
            {t("title")}
            {openCount > 0 ? ` (${openCount})` : ""}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("description")}
          </SheetDescription>
          <div className="flex items-center gap-2 pt-2">
            <Switch
              id="comments-show-resolved"
              checked={showResolved}
              onCheckedChange={setShowResolved}
            />
            <label
              htmlFor="comments-show-resolved"
              className="text-sm font-semibold"
            >
              {t("showResolved")}
            </label>
          </div>
        </SheetHeader>
        <Separator />
        <div
          aria-live="polite"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
        >
          {body}
        </div>
        {footer && <div className="border-t px-4 py-6">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
