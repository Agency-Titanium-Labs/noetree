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

  const isMe = (userId: string) =>
    Boolean(currentUserId && userId === currentUserId) ||
    Boolean(user?.id && userId === user.id);

  // Keep only online users and deduplicate multiple tabs of the same user
  const onlineUsers = (presenceList ?? []).filter(p => p.online);
  const uniqueUsers = Array.from(
    new Map(onlineUsers.map(p => [p.userId, p])).values(),
  );

  if (!noteId || uniqueUsers.length <= 1) {
    return null;
  }

  // Current user first in the pile
  const sortedUsers = [...uniqueUsers].sort((a, b) => {
    if (isMe(a.userId)) return -1;
    if (isMe(b.userId)) return 1;
    return 0;
  });

  const visibleUsers = sortedUsers.slice(0, maxVisible);
  const remainingUsers = sortedUsers.slice(maxVisible);
  const remainingCount = remainingUsers.length;

  const youLabel = t("you");

  return (
    <TooltipProvider delayDuration={200}>
      <AvatarGroup>
        {visibleUsers.map(p => {
          const userIsMe = isMe(p.userId);
          const rawName = p.name ?? (userIsMe ? youLabel : t("collaborator"));
          const displayName = userIsMe ? `${rawName} (${youLabel})` : rawName;
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
                  const userIsMe = isMe(p.userId);
                  const rawName =
                    p.name ?? (userIsMe ? youLabel : t("collaborator"));
                  const displayName = userIsMe
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
