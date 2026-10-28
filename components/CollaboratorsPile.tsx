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
import { cn } from "@/lib/utils";
import { findNoteInTree } from "@/lib/treeUtils";
import { useTreeContext } from "@/providers/TreeProvider";
import { Id } from "@/convex/_generated/dataModel";

interface CollaboratorsPileProps {
  noteId?: string;
  maxVisible?: number;
  className?: string;
}

export default function CollaboratorsPile({
  noteId,
  maxVisible = 4,
  className,
}: Readonly<CollaboratorsPileProps>) {
  const t = useTranslations("Editor");
  const { presenceList, treePresenceList } = useEditorContext();
  const { tree, onSelectNote } = useTreeContext();
  const me = useQuery(api.users.me);
  const { user } = useUser();
  const currentUserId = me?._id ?? user?.id ?? "";

  const isMe = (userId: string) =>
    Boolean(currentUserId && userId === currentUserId) ||
    Boolean(user?.id && userId === user.id);

  // If noteId is provided, filter for that note; otherwise use the tree presence list
  const sourceList = noteId ? presenceList : (treePresenceList ?? presenceList);

  // Keep only online users and deduplicate multiple tabs of the same user
  const onlineUsers = (sourceList ?? []).filter(p => {
    if (!p.online) return false;
    if (
      noteId &&
      p.data &&
      typeof p.data === "object" &&
      "activeNoteId" in (p.data as Record<string, unknown>)
    ) {
      return (p.data as { activeNoteId?: string }).activeNoteId === noteId;
    }
    return true;
  });
  const uniqueUsers = Array.from(
    new Map(onlineUsers.map(p => [p.userId, p])).values(),
  );

  if (uniqueUsers.length <= 1) {
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
      <div className={className}>
        <AvatarGroup>
          {visibleUsers.map(p => {
            const userIsMe = isMe(p.userId);
            const rawName = p.name ?? (userIsMe ? youLabel : t("collaborator"));
            const displayName = userIsMe ? `${rawName} (${youLabel})` : rawName;
            const userColor = getUserColor(p.userId);
            const textColor = getContrastTextColor(userColor);

            const userActiveNoteId =
              p.data &&
              typeof p.data === "object" &&
              "activeNoteId" in (p.data as Record<string, unknown>)
                ? (p.data as { activeNoteId?: string }).activeNoteId
                : undefined;
            const activeNote =
              userActiveNoteId && tree
                ? findNoteInTree(tree, userActiveNoteId as Id<"notes">)
                : null;
            const noteTitle = activeNote?.title;

            return (
              <Tooltip key={p.userId}>
                <TooltipTrigger asChild>
                  <Avatar
                    className={cn(
                      "transition-transform hover:scale-110 hover:z-30",
                      activeNote && !userIsMe && "cursor-pointer",
                    )}
                    onClick={() => {
                      if (activeNote && !userIsMe) {
                        onSelectNote(activeNote);
                      }
                    }}
                  >
                    <AvatarFallback
                      style={{ backgroundColor: userColor, color: textColor }}
                    >
                      {getInitials(rawName)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-center">
                  <p className="font-medium">{displayName}</p>
                  {noteTitle && (
                    <p className="text-xs text-muted-foreground">{noteTitle}</p>
                  )}
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

                    const userActiveNoteId =
                      p.data &&
                      typeof p.data === "object" &&
                      "activeNoteId" in (p.data as Record<string, unknown>)
                        ? (p.data as { activeNoteId?: string }).activeNoteId
                        : undefined;
                    const activeNote =
                      userActiveNoteId && tree
                        ? findNoteInTree(tree, userActiveNoteId as Id<"notes">)
                        : null;
                    const noteTitle = activeNote?.title;

                    return (
                      <DropdownMenuItem
                        key={p.userId}
                        className={cn(
                          "flex items-center gap-2",
                          activeNote && !userIsMe && "cursor-pointer",
                        )}
                        onClick={() => {
                          if (activeNote && !userIsMe) {
                            onSelectNote(activeNote);
                          }
                        }}
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
                        <div className="flex flex-col min-w-0">
                          <span className="truncate font-medium">
                            {displayName}
                          </span>
                          {noteTitle && (
                            <span className="text-xs text-muted-foreground truncate">
                              {noteTitle}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </AvatarGroup>
      </div>
    </TooltipProvider>
  );
}
