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

  // Keep only OTHER online users and deduplicate multiple tabs of the same user
  const otherOnlineUsers = (sourceList ?? []).filter(p => {
    if (!p.online) return false;
    if (isMe(p.userId)) return false;
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
    new Map(otherOnlineUsers.map(p => [p.userId, p])).values(),
  );

  if (uniqueUsers.length === 0) {
    return null;
  }

  const visibleUsers = uniqueUsers.slice(0, maxVisible);
  const remainingUsers = uniqueUsers.slice(maxVisible);
  const remainingCount = remainingUsers.length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={className}>
        <AvatarGroup>
          {visibleUsers.map(p => {
            const displayName = p.name ?? t("collaborator");
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
                      activeNote && "cursor-pointer",
                    )}
                    onClick={() => {
                      if (activeNote) {
                        onSelectNote(activeNote);
                      }
                    }}
                  >
                    <AvatarFallback
                      style={{ backgroundColor: userColor, color: textColor }}
                    >
                      {getInitials(displayName)}
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
                    const displayName = p.name ?? t("collaborator");
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
                          activeNote && "cursor-pointer",
                        )}
                        onClick={() => {
                          if (activeNote) {
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
                            {getInitials(displayName)}
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
