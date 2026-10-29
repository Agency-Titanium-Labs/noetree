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
  size?: "default" | "sm";
}

export default function CollaboratorsPile({
  noteId,
  maxVisible = 3,
  className,
  size = "default",
}: Readonly<CollaboratorsPileProps>) {
  const t = useTranslations("Editor");
  const {
    presenceList,
    treePresenceList,
    setHoveredCollaborator,
    followedUserId,
    setFollowedUserId,
    getCurrentContent,
  } = useEditorContext();
  const { tree, onSelectNote } = useTreeContext();
  const me = useQuery(api.users.me);
  const { user } = useUser();
  const currentUserId = me?._id ?? user?.id ?? "";

  const isMe = (userId: string) =>
    Boolean(currentUserId && userId === currentUserId) ||
    Boolean(user?.id && userId === user.id);

  // Use treePresenceList when non-empty, otherwise fallback to presenceList
  const sourceList =
    treePresenceList && treePresenceList.length > 0
      ? treePresenceList
      : presenceList;

  // Keep only OTHER online users and deduplicate multiple tabs of the same user
  const otherOnlineUsers = (sourceList ?? []).filter(p => {
    if (!p.online) return false;
    if (isMe(p.userId)) return false;
    if (noteId) {
      if (
        p.data &&
        typeof p.data === "object" &&
        "activeNoteId" in (p.data as Record<string, unknown>)
      ) {
        return (p.data as { activeNoteId?: string }).activeNoteId === noteId;
      }
      return true;
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
  const tooltipSide = noteId ? "top" : "bottom";

  return (
    <TooltipProvider delayDuration={200}>
      <div className={className}>
        <AvatarGroup className={cn(size === "sm" && "-space-x-1.5")}>
          {visibleUsers.map(p => {
            const displayName = p.name ?? t("collaborator");
            const userColor = getUserColor(p.userId);
            const textColor = getContrastTextColor(userColor);
            const isFollowed = followedUserId === p.userId;

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

            return (
              <Tooltip key={p.userId}>
                <TooltipTrigger asChild>
                  <Avatar
                    size={size}
                    className={cn(
                      "transition-transform hover:scale-110 hover:z-30 cursor-pointer",
                      isFollowed &&
                        "z-30 ring-2 ring-offset-1 ring-offset-background animate-pulse",
                    )}
                    onMouseEnter={() => {
                      const activeId =
                        userActiveNoteId ?? (noteId as Id<"notes"> | undefined);
                      if (activeId) {
                        setHoveredCollaborator({
                          userId: p.userId,
                          activeNoteId: activeId,
                          color: userColor,
                        });
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredCollaborator(null);
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      if (isFollowed) {
                        setFollowedUserId(null);
                      } else {
                        setFollowedUserId(p.userId);
                        if (activeNote) {
                          onSelectNote(activeNote, getCurrentContent);
                        }
                      }
                    }}
                  >
                    <AvatarFallback
                      style={{ backgroundColor: userColor, color: textColor }}
                      className={cn("font-bold", size === "sm" && "text-xs")}
                    >
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side={tooltipSide} className="text-center">
                  <p className="font-medium">{displayName}</p>
                  <p
                    className="text-xs font-semibold"
                    style={{ color: userColor }}
                  >
                    {isFollowed ? t("followingTooltip") : t("clickToFollow")}
                  </p>
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
                  className={cn(
                    "cursor-pointer select-none transition-transform hover:scale-110 hover:z-30",
                    size === "sm" && "size-6 text-[10px]",
                  )}
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
                    const isFollowed = followedUserId === p.userId;

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
                        className="flex items-center justify-between gap-2 cursor-pointer"
                        onMouseEnter={() => {
                          if (userActiveNoteId) {
                            setHoveredCollaborator({
                              userId: p.userId,
                              activeNoteId: userActiveNoteId,
                              color: userColor,
                            });
                          }
                        }}
                        onMouseLeave={() => {
                          setHoveredCollaborator(null);
                        }}
                        onClick={() => {
                          if (isFollowed) {
                            setFollowedUserId(null);
                          } else {
                            setFollowedUserId(p.userId);
                            if (activeNote) {
                              onSelectNote(activeNote, getCurrentContent);
                            }
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
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
                        </div>
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium ml-2 shrink-0",
                            isFollowed
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {isFollowed ? t("stopFollowing") : t("follow")}
                        </span>
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
