"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, Send, ShieldIcon, Trash2, X } from "lucide-react";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { toast } from "sonner";

import type { CommentTarget } from "@/components/CommentComposer";
import { commentErrorMessage } from "@/components/CommentComposer";
import type { CommentThreadData } from "@/components/CommentThread";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Quote, QuoteContent } from "@/components/ui/custom/quote";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { FieldGroup } from "@/components/ui/field";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import { useSafeConvexMutation } from "@/hooks/useSafeConvexMutation";
import { getInitials } from "@/lib/initials";
import { formatCompactRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";

export interface FloatingCommentCardProps {
  target: CommentTarget;
  thread: CommentThreadData;
  canComment: boolean;
  isOpen: boolean;
  virtualRef: React.RefObject<{ getBoundingClientRect: () => DOMRect }>;
  onClose: () => void;
  deleteDelayMs?: number;
}

export default function FloatingCommentCard({
  target,
  thread,
  canComment,
  isOpen,
  virtualRef,
  onClose,
  deleteDelayMs = 4000,
}: Readonly<FloatingCommentCardProps>) {
  const t = useTranslations("Comments");
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow({ updateInterval: 1000 * 60 });
  const setResolved = useSafeConvexMutation(api.comments.setResolved);
  const addComment = useSafeConvexMutation(api.comments.add);
  const removeComment = useSafeConvexMutation(api.comments.remove);

  const [replyBody, setReplyBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hiddenCommentIds, setHiddenCommentIds] = useState<Set<string>>(
    () => new Set(),
  );

  const { root, replies } = thread;
  const visibleReplies = replies.filter(
    reply => !reply.isDeleted && !hiddenCommentIds.has(reply._id),
  );
  const allComments = [root, ...visibleReplies];

  const handleResolve = async () => {
    try {
      await setResolved({
        target,
        commentId: root._id,
        resolved: true,
      });
      onClose();
      toast(t("resolvedToast"), {
        action: {
          label: t("undo"),
          onClick: () => {
            void setResolved({
              target,
              commentId: root._id,
              resolved: false,
            });
          },
        },
      });
    } catch (err) {
      toast.error(commentErrorMessage(err, t));
    }
  };

  const handleReplySubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (root.isDeleted) return;
    const trimmed = replyBody.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await addComment({
        target,
        parentId: root._id,
        body: trimmed,
      });
      setReplyBody("");
    } catch (err) {
      toast.error(commentErrorMessage(err, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (commentId: typeof root._id) => {
    const isRoot = commentId === root._id;
    const shouldClose =
      isRoot || (root.isDeleted && visibleReplies.length <= 1);
    if (shouldClose) {
      onClose();
    } else {
      setHiddenCommentIds(prev => new Set(prev).add(commentId));
    }

    const executeDelete = async () => {
      try {
        await removeComment({ target, commentId });
      } catch (err) {
        toast.error(commentErrorMessage(err, t));
        if (!shouldClose) {
          setHiddenCommentIds(prev => {
            const next = new Set(prev);
            next.delete(commentId);
            return next;
          });
        }
      }
    };

    if (deleteDelayMs <= 0) {
      void executeDelete();
      toast(t("deletedSuccess"));
      return;
    }

    let isUndone = false;
    const timer = setTimeout(() => {
      if (!isUndone) {
        void executeDelete();
      }
    }, deleteDelayMs);

    toast(t("deletedSuccess"), {
      action: {
        label: t("undo"),
        onClick: () => {
          isUndone = true;
          clearTimeout(timer);
          if (!shouldClose) {
            setHiddenCommentIds(prev => {
              const next = new Set(prev);
              next.delete(commentId);
              return next;
            });
          }
        },
      },
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-80"
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <FieldGroup className="gap-4">
          <div className="flex items-center gap-1">
            {thread.anchor && (
              <Quote variant="amber" size="sm" className="flex-1">
                <QuoteContent className="line-clamp-2">
                  &ldquo;{thread.anchor.quote}&rdquo;
                </QuoteContent>
              </Quote>
            )}
            <ButtonGroup>
              {canComment && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleResolve}
                  title={t("resolve")}
                  aria-label={t("resolve")}
                >
                  <Check />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onClose}
                title={t("close")}
                aria-label={t("close")}
              >
                <X />
              </Button>
            </ButtonGroup>
          </div>

          {/* Body: Comments list (Root + Replies) */}
          <ItemGroup className="gap-2">
            {allComments.map((comment, index) => {
              if (comment.isDeleted) {
                return (
                  <Item
                    key={comment._id}
                    className={cn("p-0", index > 0 ? "ml-4" : undefined)}
                  >
                    <ItemContent>
                      <p className="text-xs italic text-muted-foreground">
                        {t("deletedStub")}
                      </p>
                    </ItemContent>
                  </Item>
                );
              }

              const name = comment.author?.name || t("unknownAuthor");
              return (
                <Item
                  key={comment._id}
                  className={cn("p-0", index > 0 ? "ml-4" : undefined)}
                >
                  <ItemMedia className="self-start">
                    <Avatar size="sm">
                      <AvatarImage
                        src={comment.author?.avatarUrl ?? undefined}
                        alt={name}
                      />
                      <AvatarFallback>{getInitials(name)}</AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemHeader>
                      <ItemTitle>
                        <span className="text-sm">{name}</span>
                        <span
                          className="text-xs font-normal text-muted-foreground"
                          title={format.dateTime(comment._creationTime, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        >
                          {formatCompactRelativeTime(
                            comment._creationTime,
                            locale,
                            now,
                          )}
                        </span>
                      </ItemTitle>
                      {comment.isMine && (
                        <ItemActions>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleDelete(comment._id)}
                            aria-label={t("deleteAction")}
                          >
                            <Trash2 />
                          </Button>
                        </ItemActions>
                      )}
                    </ItemHeader>
                    <p className="whitespace-pre-wrap break-words text-xs">
                      {comment.body}
                    </p>
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>

          {/* Footer: Quick reply form */}
          {canComment && !root.isDeleted && (
            <form onSubmit={handleReplySubmit} onKeyDown={handleKeyDown}>
              <ButtonGroup className="w-full">
                <Input
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder={t("replyPlaceholder")}
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={!replyBody.trim() || isSubmitting}
                  aria-label={t("replyAction")}
                >
                  <Send />
                </Button>
              </ButtonGroup>
            </form>
          )}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
