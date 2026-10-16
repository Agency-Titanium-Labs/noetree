"use client";

import { Button } from "../ui/button";
import {
  Link as LinkIcon,
  Image as ImageIcon,
  Check,
  Sparkles,
} from "lucide-react";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { ToolbarGroup } from "./ToolbarGroup";
import {
  formattingItems,
  headingItems,
  historyItems,
  listItems,
  specialItems,
} from "./toolbarItems";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useState } from "react";
import { useEditorContext } from "@/providers/EditorProvider";
import { useTranslations } from "next-intl";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import CreditsExhaustedDialog from "@/components/CreditsExhaustedDialog";

export default function EditorToolbar() {
  const t = useTranslations("Editor");
  const tCredits = useTranslations("AiCredits");
  const { editor } = useEditorContext();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);

  // D-09: balance defaults to 0 when the user has no aiCredits row yet.
  const { data: credits } = useQuery(
    convexQuery(api.aiCredits.getMyCredits, {}),
  );
  const balance = credits?.balance ?? 0;

  // T-05-02: the client never gates the click on balance — runAiAction
  // enforces the balance check server-side and throws INSUFFICIENT_CREDITS,
  // which opens the blocking dialog below.
  const runAiActionMutate = useConvexMutation(api.aiCredits.runAiAction);
  const runAiAction = useMutation({
    mutationFn: runAiActionMutate,
    onError: err => {
      if (err instanceof ConvexError && err.data === "INSUFFICIENT_CREDITS") {
        setCreditsDialogOpen(true);
      }
    },
  });
  const handleAiAction = () => runAiAction.mutate({});

  if (!editor || !editor.isEditable) return null;

  const openLinkDialog = () => {
    if (!editor) return;

    // If there's already a link selected, get its attributes
    if (editor.isActive("link")) {
      const attrs = editor.getAttributes("link");
      setLinkUrl(attrs.href || "");
      setLinkText(
        editor.state.selection.content().content.firstChild?.text || "",
      );
    } else {
      setLinkUrl("");
      setLinkText(
        editor.state.selection.content().content.firstChild?.text || "",
      );
    }

    setLinkDialogOpen(true);
  };

  const insertLink = () => {
    if (!editor) return;

    // If URL is empty, remove the link
    if (!linkUrl) {
      editor.chain().focus().unsetLink().run();
      setLinkDialogOpen(false);
      return;
    }

    // If text is selected, update it with link text if provided
    if (linkText) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .insertContent(linkText)
        .run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .run();
    }

    setLinkDialogOpen(false);
  };

  const openImageDialog = () => {
    setImageUrl("");
    setImageAlt("");
    setImageDialogOpen(true);
  };

  const insertImage = () => {
    if (!editor || !imageUrl) return;

    editor
      .chain()
      .focus()
      .setImage({
        src: imageUrl,
        alt: imageAlt || "Image",
      })
      .run();

    setImageDialogOpen(false);
  };

  return (
    <TooltipProvider delayDuration={1000}>
      <div className="flex flex-wrap gap-1">
        <ToolbarGroup items={historyItems} />

        <Separator orientation="vertical" className="h-auto!" />

        <ToolbarGroup items={headingItems} />

        <Separator orientation="vertical" className="h-auto!" />

        <ToolbarGroup items={formattingItems} />

        <Separator orientation="vertical" className="h-auto!" />

        <ToolbarGroup items={listItems} />

        <Separator orientation="vertical" className="h-auto!" />

        {/* Special elements group */}
        <ToolbarGroup items={specialItems} />

        <Separator orientation="vertical" className="h-auto!" />

        {/* Extra features */}
        <ToolbarButton
          onClick={openLinkDialog}
          active={editor?.isActive("link")}
          tooltip={t("tooltips.link")}
          icon={<LinkIcon className="h-4 w-4" />}
        />
        <ToolbarButton
          onClick={openImageDialog}
          tooltip={t("tooltips.image")}
          icon={<ImageIcon className="h-4 w-4" />}
        />

        <Separator orientation="vertical" className="h-auto!" />

        {/* AI action + credits balance */}
        <ToolbarButton
          onClick={handleAiAction}
          tooltip={t("tooltips.aiAction")}
          icon={<Sparkles className="h-4 w-4" />}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary">{balance}</Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {tCredits("badgeTooltip", { count: balance })}
          </TooltipContent>
        </Tooltip>

        {/* Link Dialog */}
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("dialogs.linkTitle")}</DialogTitle>
              <DialogDescription>{t("dialogs.linkDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="url">{t("dialogs.url")}</Label>
                <Input
                  id="url"
                  placeholder="https://example.com"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="linkText">{t("dialogs.linkText")}</Label>
                <Input
                  id="linkText"
                  placeholder={t("dialogs.linkTextPlaceholder")}
                  value={linkText}
                  onChange={e => setLinkText(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLinkDialogOpen(false)}
              >
                {t("dialogs.cancel")}
              </Button>
              <Button type="button" onClick={insertLink} className="gap-1">
                <Check className="h-4 w-4" />
                {t("dialogs.insertLink")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Image Dialog */}
        <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("dialogs.imageTitle")}</DialogTitle>
              <DialogDescription>{t("dialogs.imageDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="imageUrl">{t("dialogs.imageUrl")}</Label>
                <Input
                  id="imageUrl"
                  placeholder="https://example.com/image.jpg"
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="imageAlt">{t("dialogs.imageAlt")}</Label>
                <Input
                  id="imageAlt"
                  placeholder={t("dialogs.imageAltPlaceholder")}
                  value={imageAlt}
                  onChange={e => setImageAlt(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImageDialogOpen(false)}
              >
                {t("dialogs.cancel")}
              </Button>
              <Button type="button" onClick={insertImage} className="gap-1">
                <Check className="h-4 w-4" />
                {t("dialogs.insertImage")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Credits Exhausted Dialog */}
        <CreditsExhaustedDialog
          open={creditsDialogOpen}
          onOpenChange={setCreditsDialogOpen}
        />
      </div>
    </TooltipProvider>
  );
}

EditorToolbar.displayName = "EditorToolbar";

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tooltip: string;
  icon: React.ReactNode;
}

const ToolbarButton = ({
  onClick,
  active,
  disabled,
  tooltip,
  icon,
}: ToolbarButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        size="icon"
        variant={active ? "secondary" : "ghost"}
        onClick={onClick}
        disabled={disabled}
        className="h-8 w-8"
      >
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{tooltip}</TooltipContent>
  </Tooltip>
);
