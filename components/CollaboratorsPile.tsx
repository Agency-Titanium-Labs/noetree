"use client";

import { useEditorContext } from "@/providers/EditorProvider";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/initials";
import {
  getContrastTextColor,
  getUserColor,
} from "@/lib/editor/collaborativeCursors";

interface CollaboratorsPileProps {
  noteId?: string;
  maxVisible?: number;
}

export default function CollaboratorsPile({
  noteId,
  maxVisible = 4,
}: CollaboratorsPileProps) {
  const t = useTranslations("Editor");
  const { presenceList } = useEditorContext();
  const me = useQuery(api.users.me);
  const { user } = useUser();
  const currentUserId = me?._id ?? user?.id ?? "";

  if (!noteId || !presenceList || presenceList.length <= 1) {
    return null;
  }

  const onlineUsers = presenceList.filter(p => p.online);
  const visibleUsers = onlineUsers.slice(0, maxVisible);
  const remainingUsers = onlineUsers.slice(maxVisible);
  const remainingCount = remainingUsers.length;

  const youLabel = t("you");

  return (
    <TooltipProvider delayDuration={200}>
      <AvatarGroup>
        {visibleUsers.map(p => {
          const isMe =
            Boolean(currentUserId && p.userId === currentUserId) ||
            Boolean(user?.id && p.userId === user.id);
          const rawName = p.name ?? (isMe ? youLabel : t("collaborator"));
          const displayName = isMe ? `${rawName} (${youLabel})` : rawName;
          const userColor = getUserColor(p.userId);
          const textColor = getContrastTextColor(userColor);

          return (
            <Tooltip key={p.userId}>
              <TooltipTrigger asChild>
                <Avatar className="transition-transform hover:scale-110 hover:z-30">
                  <AvatarFallback
                    style={{ backgroundColor: userColor, color: textColor }}
                  >
                    {getInitials(rawName)}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{displayName}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {remainingCount > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <AvatarGroupCount
                role="button"
                tabIndex={0}
                className="cursor-pointer select-none transition-transform hover:scale-110 hover:z-30"
              >
                +{remainingCount}
              </AvatarGroupCount>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("collaborators")} ({remainingCount})
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {remainingUsers.map(p => {
                  const isMe =
                    Boolean(currentUserId && p.userId === currentUserId) ||
                    Boolean(user?.id && p.userId === user.id);
                  const rawName =
                    p.name ?? (isMe ? youLabel : t("collaborator"));
                  const displayName = isMe
                    ? `${rawName} (${youLabel})`
                    : rawName;
                  const userColor = getUserColor(p.userId);
                  const textColor = getContrastTextColor(userColor);

                  return (
                    <DropdownMenuItem
                      key={p.userId}
                      className="flex items-center gap-2"
                    >
                      <Avatar size="sm">
                        <AvatarFallback
                          style={{
                            backgroundColor: userColor,
                            color: textColor,
                          }}
                        >
                          {getInitials(rawName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{displayName}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </AvatarGroup>
    </TooltipProvider>
  );
}
