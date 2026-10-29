"use client";

import { useEditorContext } from "@/providers/EditorProvider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { getInitials } from "@/lib/initials";
import { getContrastTextColor } from "@/lib/editor/collaborativeCursors";
import { Eye, X } from "lucide-react";
import { useTranslations } from "next-intl";

export default function FollowBanner() {
  const t = useTranslations("Editor");
  const { followedCollaborator, setFollowedUserId } = useEditorContext();

  if (!followedCollaborator) {
    return null;
  }

  const name = followedCollaborator.name ?? "";
  const color = followedCollaborator.color ?? "";
  const textColor = color ? getContrastTextColor(color) : "#ffffff";

  return (
    <Card
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-row items-center gap-2.5 px-3 py-1.5"
    >
      <Avatar size="sm">
        <AvatarFallback
          className="font-bold"
          style={{ backgroundColor: color, color: textColor }}
        >
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Eye className="w-3.5 h-3.5 animate-pulse" style={{ color }} />
        <span>{t("following", { name })}</span>
      </div>

      <Button variant="ghost" size="sm" onClick={() => setFollowedUserId(null)}>
        <X />
        <span>{t("stopFollowing")}</span>
        <Kbd>{t("escapeKey")}</Kbd>
      </Button>
    </Card>
  );
}
