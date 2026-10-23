"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useConvexMutation } from "@convex-dev/react-query";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type CommentTarget = FunctionArgs<typeof api.comments.list>["target"];

const MAX_LENGTH = 2000;
const COUNTER_THRESHOLD = 1800;
const LINE_HEIGHT_PX = 21;

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function commentErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof ConvexError) {
    switch (err.data) {
      case "COMMENT_TOO_LONG":
        return t("errorTooLong");
      case "RATE_LIMITED":
        return t("errorRateLimited");
      case "COMMENT_LIMIT":
        return t("errorLimit");
      case "NOT_ALLOWED":
      case "UNAUTHENTICATED":
        return t("errorNoAccess");
    }
  }
  return t("errorGeneric");
}

export default function CommentComposer({
  target,
  parentId,
  compact = false,
  autoFocus = false,
  onPosted,
  onCancel,
}: Readonly<{
  target: CommentTarget;
  parentId?: Id<"comments">;
  compact?: boolean;
  autoFocus?: boolean;
  onPosted?: () => void;
  onCancel?: () => void;
}>) {
  const t = useTranslations("Comments");
  const addComment = useConvexMutation(api.comments.add);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * LINE_HEIGHT_PX)}px`;
  }, [body]);

  const canSubmit =
    body.trim().length > 0 && body.length <= MAX_LENGTH && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    try {
      await addComment({ target, body, ...(parentId ? { parentId } : {}) });
      setBody("");
      onPosted?.();
    } catch (err) {
      toast.error(commentErrorMessage(err, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={ref}
        value={body}
        rows={compact ? 2 : 3}
        autoFocus={autoFocus}
        placeholder={t("placeholder")}
        aria-label={t("placeholder")}
        className="resize-none overflow-y-auto"
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && compact && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {body.length > COUNTER_THRESHOLD
            ? t("charCount", { count: body.length })
            : ""}
        </span>
        <div className="flex items-center gap-2">
          {compact && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t("discardReply")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t(compact ? "replyCta" : "postCta")}
          </Button>
        </div>
      </div>
    </div>
  );
}
