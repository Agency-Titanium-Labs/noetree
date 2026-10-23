"use client";

import { useState } from "react";
import { useConvexMutation } from "@convex-dev/react-query";
import { ConvexError } from "convex/values";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatFullDate } from "@/lib/relativeTime";
import { useEditorContext } from "@/providers/EditorProvider";
import { useTreeContext } from "@/providers/TreeProvider";

export function historyErrorMessage(
  err: unknown,
  t: (k: string) => string,
  fallbackKey: "errorRestore" | "errorLoad",
): string {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (data === "VERSION_OUT_OF_WINDOW") return t("errorOutOfWindow");
    if (data === "NOT_ALLOWED" || data === "UNAUTHENTICATED") {
      return t("errorNoAccess");
    }
  }
  return t(fallbackKey);
}

export default function VersionPreviewBanner() {
  const t = useTranslations("History");
  const locale = useLocale();
  const { previewVersion, exitPreview } = useEditorContext();
  const { selectedNote } = useTreeContext();
  const restore = useConvexMutation(api.noteVersions.restore);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (!previewVersion) return null;

  const titleDiffers =
    !!selectedNote && previewVersion.title !== selectedNote.title;

  const onConfirm = async () => {
    setPending(true);
    try {
      const result = await restore({
        versionId: previewVersion._id as Id<"noteVersions">,
      });
      setOpen(false);
      exitPreview(result.content);
      toast(t("restoreSuccess"));
    } catch (err) {
      toast.error(historyErrorMessage(err, t, "errorRestore"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="status"
      className="flex flex-col gap-2 border-b bg-muted px-4 py-2 text-sm md:flex-row md:items-center md:justify-between"
      onKeyDown={e => {
        if (e.key === "Escape" && !open) exitPreview();
      }}
    >
      <div className="flex flex-col">
        <span>
          {t("bannerViewing", {
            date: formatFullDate(previewVersion.createdAt, locale),
          })}
        </span>
        {titleDiffers && (
          <span className="text-muted-foreground">
            {t("bannerTitleThen", { title: previewVersion.title })}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 flex-1 md:min-h-9 md:flex-none"
          onClick={() => exitPreview()}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToCurrent")}
        </Button>
        <Button
          type="button"
          className="min-h-11 flex-1 md:min-h-9 md:flex-none"
          onClick={() => setOpen(true)}
        >
          <RotateCcw className="size-4" aria-hidden />
          {t("restoreVersion")}
        </Button>
      </div>
      <AlertDialog
        open={open}
        onOpenChange={next => {
          if (!pending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("restoreDialogBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("keepCurrent")}
            </AlertDialogCancel>
            <Button
              type="button"
              autoFocus
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t("restoring")}
                </>
              ) : (
                t("restoreVersion")
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
