"use client";

import { useEffect, useRef, useState } from "react";
import { useConvexMutation } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import CommentComposer, {
  commentErrorMessage,
  type CommentTarget,
} from "@/components/CommentComposer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { getInitials } from "@/lib/initials";
import { formatFullDate, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";

type ListResult = NonNullable<FunctionReturnType<typeof api.comments.list>>;
export type CommentThreadData = ListResult["threads"][number];
type CommentViewData = CommentThreadData["root"];

const ACTION_CLASS =
  "h-auto min-h-11 px-2 py-1 text-xs md:min-h-7 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100";

function CommentItem({
  comment,
  isRoot,
  canComment,
  highlighted,
  onReply,
  onResolve,
  onDelete,
}: Readonly<{
  comment: CommentViewData;
  isRoot: boolean;
  canComment: boolean;
  highlighted: boolean;
  onReply?: () => void;
  onResolve?: () => void;
  onDelete: () => void;
}>) {
  const t = useTranslations("Comments");
  const locale = useLocale();
  const name = comment.author?.name ?? t("unknownAuthor");

  return (
    <div
      id={`comment-${comment._id}`}
      className={cn(
        "group flex gap-2 rounded-md p-1 transition-colors",
        highlighted && "bg-accent",
      )}
    >
      <Avatar className="size-8 shrink-0">
        {!comment.isDeleted && comment.author?.avatarUrl ? (
          <AvatarImage src={comment.author.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback>
          {comment.isDeleted ? "" : getInitials(comment.author?.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        {comment.isDeleted ? (
          <p className="text-sm italic text-muted-foreground">
            {t("deletedStub")}
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="truncate text-sm font-semibold">{name}</span>
              <span
                className="text-xs text-muted-foreground"
                title={formatFullDate(comment._creationTime, locale)}
              >
                {formatRelativeTime(comment._creationTime, locale)}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">
              {comment.body}
            </p>
            {canComment && (
              <div className="flex flex-wrap items-center gap-1">
                {isRoot && onReply && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={ACTION_CLASS}
                    onClick={onReply}
                  >
                    {t("replyAction")}
                  </Button>
                )}
                {isRoot && onResolve && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={ACTION_CLASS}
                    onClick={onResolve}
                  >
                    {t("resolve")}
                  </Button>
                )}
                {comment.canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(ACTION_CLASS, "hover:text-destructive")}
                    onClick={onDelete}
                  >
                    {t("deleteAction")}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CommentThread({
  target,
  thread,
  canComment,
  showResolved,
  focusCommentId,
}: Readonly<{
  target: CommentTarget;
  thread: CommentThreadData;
  canComment: boolean;
  showResolved: boolean;
  focusCommentId?: string | null;
}>) {
  const t = useTranslations("Comments");
  const locale = useLocale();
  const setResolved = useConvexMutation(api.comments.setResolved);
  const removeComment = useConvexMutation(api.comments.remove);
  const [replying, setReplying] = useState(false);
  const [deleteId, setDeleteId] = useState<CommentViewData["_id"] | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { root, replies } = thread;
  const resolved = thread.resolvedAt !== null;

  useEffect(() => {
    if (!focusCommentId) return;
    const ids = [root._id, ...replies.map(r => r._id)] as string[];
    if (!ids.includes(focusCommentId)) return;
    if (resolved && !showResolved) return;
    const el = rootRef.current?.querySelector(`#comment-${focusCommentId}`);
    el?.scrollIntoView?.({ block: "center" });
    setHighlightId(focusCommentId);
    const timer = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCommentId]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(commentErrorMessage(err, t));
    }
  };

  const doSetResolved = (value: boolean) =>
    setResolved({ target, commentId: root._id, resolved: value });

  const handleResolve = () =>
    run(async () => {
      await doSetResolved(true);
      toast(t("resolvedToast"), {
        action: {
          label: t("undo"),
          onClick: () => void run(() => doSetResolved(false)),
        },
      });
    });

  if (resolved) {
    if (!showResolved) return null;
    const firstLine = root.isDeleted ? "" : (root.body.split("\n")[0] ?? "");
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm">
        <Check className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">
            {t("resolvedStub", {
              name: thread.resolvedByName ?? t("unknownAuthor"),
            })}
          </span>
          {firstLine && (
            <span className="text-muted-foreground"> {firstLine}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(thread.resolvedAt as number, locale)}
        </span>
        {canComment && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void run(() => doSetResolved(false))}
          >
            {t("unresolve")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <CommentItem
        comment={root}
        isRoot
        canComment={canComment}
        highlighted={highlightId === root._id}
        onReply={() => setReplying(true)}
        onResolve={() => void handleResolve()}
        onDelete={() => setDeleteId(root._id)}
      />
      {(replies.length > 0 || replying) && (
        <div className="ml-8 flex flex-col gap-2 border-l pl-4">
          {replies.map(reply => (
            <CommentItem
              key={reply._id}
              comment={reply}
              isRoot={false}
              canComment={canComment}
              highlighted={highlightId === reply._id}
              onDelete={() => setDeleteId(reply._id)}
            />
          ))}
          {replying && canComment && (
            <CommentComposer
              target={target}
              parentId={root._id}
              compact
              autoFocus
              onPosted={() => setReplying(false)}
              onCancel={() => setReplying(false)}
            />
          )}
        </div>
      )}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={open => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteDismiss")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const id = deleteId;
                setDeleteId(null);
                if (id) {
                  void run(() => removeComment({ target, commentId: id }));
                }
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
