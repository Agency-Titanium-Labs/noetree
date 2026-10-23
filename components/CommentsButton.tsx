"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CommentTarget } from "@/components/CommentComposer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

export default function CommentsButton({
  target,
  isOpen,
  onClick,
}: Readonly<{
  target: CommentTarget;
  isOpen: boolean;
  onClick: () => void;
}>) {
  const t = useTranslations("Comments");
  const { data } = useQuery(convexQuery(api.comments.count, { target }));
  const count = data ?? 0;

  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
      aria-label={t("buttonAria", { count })}
      aria-expanded={isOpen}
      onClick={onClick}
    >
      <MessageSquare className="size-4" aria-hidden />
      {count > 0 && (
        <Badge
          variant="secondary"
          className={cn(isOpen && "bg-primary text-primary-foreground")}
        >
          {count >= 100 ? "99+" : count}
        </Badge>
      )}
    </Button>
  );
}
