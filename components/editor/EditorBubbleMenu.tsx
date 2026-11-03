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
  Quote,
  TerminalSquare,
  MoreHorizontal,
  ChevronDown,
  Check,
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

interface EditorBubbleMenuProps {
  onOpenChat?: (mode?: "chat" | "tree") => void;
}

export default function EditorBubbleMenu({
  onOpenChat,
}: Readonly<EditorBubbleMenuProps>) {
  const { editor, previewVersion } = useEditorContext();
  const t = useTranslations("Editor");
  const [isDismissed, setIsDismissed] = useState(false);
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

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

  const isAnyMenuOpen = headingsOpen || moreOpen || linkOpen;

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
              <Quote />
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
