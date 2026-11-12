"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Unlink,
  Sparkles,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  ListTodo,
  Quote as QuoteIcon,
  TerminalSquare,
  MoreHorizontal,
  ChevronDown,
  Check,
  MessageSquarePlus,
} from "lucide-react";
import { useEditorContext } from "@/providers/EditorProvider";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup } from "@/components/ui/field";
import { Quote, QuoteContent } from "@/components/ui/custom/quote";
import { useSafeConvexMutation } from "@/hooks/useSafeConvexMutation";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import type { CommentTarget } from "@/components/CommentComposer";
import { commentErrorMessage } from "@/components/CommentComposer";

interface EditorBubbleMenuProps {
  onOpenChat?: (mode?: "chat" | "tree") => void;
  onOpenComments?: () => void;
  commentsTarget?: CommentTarget | null;
  canComment?: boolean;
}

export default function EditorBubbleMenu({
  onOpenChat,
  onOpenComments,
  commentsTarget,
  canComment = false,
}: Readonly<EditorBubbleMenuProps>) {
  const { editor, previewVersion, setPendingAnchor } = useEditorContext();
  const t = useTranslations("Editor");
  const [isDismissed, setIsDismissed] = useState(false);
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentQuote, setCommentQuote] = useState("");
  const [selectionRange, setSelectionRange] = useState<{
    from: number;
    to: number;
  }>({ from: 0, to: 0 });
  const [commentBody, setCommentBody] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const addComment = useSafeConvexMutation(api.comments.add);

  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      setIsDismissed(false);
    };
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor]);

  if (!editor || isDismissed) return null;

  const isAnyMenuOpen = headingsOpen || moreOpen || linkOpen || commentOpen;

  const handleOpenCommentPopover = (open: boolean) => {
    setCommentOpen(open);
    if (open && editor) {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
      setCommentQuote(selectedText.slice(0, 500));
      setSelectionRange({ from, to });
      setCommentBody("");
    }
  };

  const handleCreateComment = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!commentsTarget || !commentBody.trim() || isSubmittingComment) return;

    setIsSubmittingComment(true);
    try {
      await addComment({
        target: commentsTarget,
        body: commentBody.trim(),
        anchor: {
          quote: commentQuote,
          from: selectionRange.from,
          to: selectionRange.to,
        },
      });
      setCommentOpen(false);
      setCommentBody("");
      setIsDismissed(true);
    } catch (err) {
      toast.error(commentErrorMessage(err, t));
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleApplyLink = (e: SubmitEvent) => {
    e.preventDefault();
    const trimmed = linkUrl.trim();
    if (trimmed) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: trimmed })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkOpen(false);
  };

  const handleRemoveLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkUrl("");
    setLinkOpen(false);
  };

  const activeHeading = ([1, 2, 3] as const).find(level =>
    editor.isActive("heading", { level }),
  );
  const isParagraphActive = editor.isActive("paragraph");

  const isBulletActive = editor.isActive("bulletList");
  const isOrderedActive = editor.isActive("orderedList");
  const isTaskActive = editor.isActive("taskList");
  const isQuoteActive = editor.isActive("blockquote");
  const isCodeBlockActive = editor.isActive("codeBlock");
  const isMoreActive =
    isBulletActive ||
    isOrderedActive ||
    isTaskActive ||
    isQuoteActive ||
    isCodeBlockActive;

  const handleOpenComment = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    if (selectedText) {
      setPendingAnchor({
        quote: selectedText.slice(0, 500),
        from,
        to,
      });
    } else {
      setPendingAnchor(null);
    }
    setIsDismissed(true);
    onOpenComments?.();
  };

  return (
    <BubbleMenu
      editor={editor}
      appendTo={typeof document !== "undefined" ? document.body : undefined}
      shouldShow={({ from, to }) => {
        if (isAnyMenuOpen) return true;
        return Boolean(
          editor.isEditable &&
          !previewVersion &&
          !editor.state.selection.empty &&
          from !== to &&
          !editor.isActive("image"),
        );
      }}
      options={{
        placement: "top",
        offset: 8,
        flip: true,
        shift: true,
      }}
    >
      <div
        data-testid="bubble-menu"
        className="flex items-center gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {onOpenChat && (
          <Button
            type="button"
            size="sm"
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              setIsDismissed(true);
              onOpenChat();
            }}
            aria-label={t("bubbleMenu.aiAsk")}
          >
            <Sparkles />
            <span className="hidden sm:inline">{t("bubbleMenu.aiAsk")}</span>
          </Button>
        )}

        {commentsTarget && canComment ? (
          <Popover
            modal={false}
            open={commentOpen}
            onOpenChange={handleOpenCommentPopover}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant={commentOpen ? "secondary" : "ghost"}
                size="icon"
                onMouseDown={e => e.preventDefault()}
                aria-label={t("bubbleMenu.comment")}
              >
                <MessageSquarePlus />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80"
              align="start"
              onCloseAutoFocus={e => e.preventDefault()}
            >
              <form
                onSubmit={handleCreateComment}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.requestSubmit();
                  }
                }}
              >
                <FieldGroup className="gap-4">
                  {commentQuote && (
                    <Quote variant="amber" size="sm">
                      <QuoteContent className="line-clamp-2">
                        &ldquo;{commentQuote}&rdquo;
                      </QuoteContent>
                    </Quote>
                  )}
                  <Textarea
                    value={commentBody}
                    onChange={e => setCommentBody(e.target.value)}
                    placeholder={t("bubbleMenu.commentPlaceholder")}
                    rows={2}
                    autoFocus
                  />
                  <Field orientation="horizontal" className="justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCommentOpen(false)}
                    >
                      {t("bubbleMenu.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!commentBody.trim() || isSubmittingComment}
                    >
                      {t("bubbleMenu.commentPost")}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            </PopoverContent>
          </Popover>
        ) : onOpenComments ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            onClick={handleOpenComment}
            aria-label={t("bubbleMenu.comment")}
          >
            <MessageSquarePlus />
          </Button>
        ) : null}

        <DropdownMenu
          modal={false}
          open={headingsOpen}
          onOpenChange={setHeadingsOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={activeHeading ? "secondary" : "ghost"}
              size="sm"
              onMouseDown={e => e.preventDefault()}
              aria-label={t("tooltips.headings")}
            >
              {activeHeading === 1 && <Heading1 />}
              {activeHeading === 2 && <Heading2 />}
              {activeHeading === 3 && <Heading3 />}
              {!activeHeading && <Heading />}
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onCloseAutoFocus={e => e.preventDefault()}
          >
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() => editor.chain().focus().setParagraph().run()}
              className={isParagraphActive ? "bg-accent font-medium" : ""}
            >
              <Pilcrow />
              <span>{t("tooltips.paragraph")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              className={activeHeading === 1 ? "bg-accent font-medium" : ""}
            >
              <Heading1 />
              <span>{t("tooltips.heading-1")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className={activeHeading === 2 ? "bg-accent font-medium" : ""}
            >
              <Heading2 />
              <span>{t("tooltips.heading-2")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
              className={activeHeading === 3 ? "bg-accent font-medium" : ""}
            >
              <Heading3 />
              <span>{t("tooltips.heading-3")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToggleGroup
          type="multiple"
          size="sm"
          value={[
            editor.isActive("bold") ? "bold" : "",
            editor.isActive("italic") ? "italic" : "",
            editor.isActive("strike") ? "strike" : "",
            editor.isActive("code") ? "code" : "",
          ].filter(Boolean)}
        >
          <ToggleGroupItem
            value="bold"
            aria-label={t("tooltips.bold")}
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="italic"
            aria-label={t("tooltips.italic")}
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="strike"
            aria-label={t("tooltips.strike")}
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="code"
            aria-label={t("tooltips.code")}
            onPointerDown={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code />
          </ToggleGroupItem>
        </ToggleGroup>

        <Popover
          modal={false}
          open={linkOpen}
          onOpenChange={open => {
            setLinkOpen(open);
            if (open) {
              setLinkUrl((editor.getAttributes("link").href as string) || "");
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={editor.isActive("link") ? "secondary" : "ghost"}
              size="icon"
              onMouseDown={e => e.preventDefault()}
              aria-label={t("tooltips.link")}
            >
              <LinkIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-2"
            align="start"
            onCloseAutoFocus={e => e.preventDefault()}
          >
            <form onSubmit={handleApplyLink}>
              <ButtonGroup className="w-full">
                <Input
                  type="url"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  placeholder={t("bubbleMenu.linkPlaceholder")}
                  className="text-xs"
                  autoFocus
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="outline"
                  aria-label={t("bubbleMenu.applyLink")}
                >
                  <Check />
                </Button>
                {editor.isActive("link") && (
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    onClick={handleRemoveLink}
                    aria-label={t("bubbleMenu.removeLink")}
                  >
                    <Unlink />
                  </Button>
                )}
              </ButtonGroup>
            </form>
          </PopoverContent>
        </Popover>

        <DropdownMenu modal={false} open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={isMoreActive ? "secondary" : "ghost"}
              size="icon"
              onMouseDown={e => e.preventDefault()}
              aria-label={t("bubbleMenu.more")}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={e => e.preventDefault()}
          >
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() => editor.chain().focus().toggleBulletList().run()}
              className={isBulletActive ? "bg-accent font-medium" : ""}
            >
              <List />
              <span>{t("tooltips.bulletList")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() => editor.chain().focus().toggleOrderedList().run()}
              className={isOrderedActive ? "bg-accent font-medium" : ""}
            >
              <ListOrdered />
              <span>{t("tooltips.orderedList")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() => editor.chain().focus().toggleTaskList().run()}
              className={isTaskActive ? "bg-accent font-medium" : ""}
            >
              <ListTodo />
              <span>{t("tooltips.taskList")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() => editor.chain().focus().toggleBlockquote().run()}
              className={isQuoteActive ? "bg-accent font-medium" : ""}
            >
              <QuoteIcon />
              <span>{t("tooltips.blockquote")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseDown={e => e.preventDefault()}
              onSelect={() => editor.chain().focus().toggleCodeBlock().run()}
              className={isCodeBlockActive ? "bg-accent font-medium" : ""}
            >
              <TerminalSquare />
              <span>{t("tooltips.codeBlock")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </BubbleMenu>
  );
}
