import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Copy,
  UserPlus,
  MoreVertical,
  Edit,
  LogOut,
  Users,
} from "lucide-react";
import { NoteTree, useTreeContext } from "@/providers/TreeProvider";
import { useEditorContext } from "@/providers/EditorProvider";
import ConditionChecker from "./helpers/ConditionChecker";
import { useTranslations } from "next-intl";
import ShareDialog from "@/components/ShareDialog";

interface NoteCardProps {
  note: NoteTree;
  isRoot: boolean;
  onAddChild: () => void;
  onDelete: () => void;
  onRef?: (el: HTMLDivElement | null) => void;
  handleRef?: (el: HTMLDivElement | null) => void;
  targetRef?: (el: HTMLDivElement | null) => void;
  isNestingHovered?: boolean;
}

export function NoteCard({
  note,
  isRoot,
  onAddChild,
  onDelete,
  onRef,
  handleRef,
  targetRef,
  isNestingHovered,
}: NoteCardProps) {
  const t = useTranslations("NoteCard");
  const { onSelectNote, onUpdateNoteTitle, onDuplicateNote, selectedNote } =
    useTreeContext();
  const { getCurrentContent } = useEditorContext();

  const [isRenaming, setIsRenaming] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [editedTitle, setEditedTitle] = useState(note.title);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isSelected = selectedNote?._id === note._id;
  const isTemp = typeof note._id === "string" && note._id.startsWith("temp-");
  const menuActions = useMemo(() => {
    return [
      {
        id: "addChild",
        label: t("contextMenu.addChild"),
        icon: <Plus />,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onAddChild();
        },
        show: note.role !== "view",
      },
      {
        id: "rename",
        label: t("contextMenu.rename"),
        icon: <Edit />,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          setIsRenaming(true);
        },
        show: note.role !== "view",
      },
      {
        id: "share",
        label: t("contextMenu.share"),
        icon: <UserPlus />,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          setIsShareOpen(true);
        },
        show: note.role === "owner" || note.role === "admin",
      },
      {
        id: "duplicate",
        label: t("contextMenu.duplicate"),
        icon: <Copy />,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onDuplicateNote(note._id);
        },
        show: !isRoot && note.role !== "view",
      },
      {
        id: "leave",
        label: t("contextMenu.leave"),
        icon: <LogOut />,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onDelete();
        },
        variant: "destructive" as const,
        show: isRoot && !!note.isShared,
      },
      {
        id: "delete",
        label: t("contextMenu.delete"),
        icon: <Trash2 />,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onDelete();
        },
        variant: "destructive" as const,
        show: !isRoot && note.role !== "view",
      },
    ].filter(action => action.show);
  }, [
    note.role,
    note._id,
    isRoot,
    note.isShared,
    onAddChild,
    onDuplicateNote,
    onDelete,
    t,
  ]);

  const combinedRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (handleRef) handleRef(el);
      if (targetRef) targetRef(el);
      if (isSelected) onRef?.(el);
    },
    [handleRef, targetRef, isSelected, onRef],
  );

  useEffect(() => {
    if (isRenaming) {
      setEditedTitle(note.title);
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
        // JS fallback for browsers without field-sizing: content
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }, 0);
    }
  }, [isRenaming, note.title]);

  const handleSaveRename = () => {
    if (editedTitle.trim() !== "" && editedTitle !== note.title) {
      onUpdateNoteTitle(note._id, editedTitle);
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // prevent newline in textarea
      handleSaveRename();
    }
    if (e.key === "Escape") {
      setIsRenaming(false);
      setEditedTitle(note.title);
    }
  };

  return (
    <div
      ref={combinedRef}
      className={cn(
        "relative group/node",
        isTemp && "opacity-60 pointer-events-none animate-pulse",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger disabled={isRenaming || isTemp}>
          <Card
            className={cn(
              "cursor-pointer transition-all bg-background hover:bg-accent/50 group border-border shadow-md min-w-30 max-w-60 relative overflow-hidden",
              isSelected
                ? "bg-accent/30 border-primary ring-2 ring-primary/20"
                : "",
              isNestingHovered
                ? "border-primary ring-2 ring-primary/50 bg-primary/5 scale-105"
                : "",
            )}
            onClick={() =>
              !isRenaming && !isTemp && onSelectNote(note, getCurrentContent)
            }
            onDoubleClick={() =>
              !isTemp && note.role !== "view" && setIsRenaming(true)
            }
          >
            <div className="flex flex-col items-center p-3">
              <ConditionChecker condition={isRenaming}>
                <textarea
                  ref={inputRef}
                  value={editedTitle}
                  rows={1}
                  onChange={e => {
                    setEditedTitle(e.target.value);
                    // auto-resize fallback
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSaveRename}
                  onClick={e => e.stopPropagation()}
                  className="w-full resize-none overflow-hidden bg-transparent text-sm font-semibold text-center border-none outline-none p-0 focus:ring-0 focus:outline-none leading-initial"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
              </ConditionChecker>
              <ConditionChecker condition={!isRenaming}>
                <>
                  <span className="text-sm font-semibold text-center">
                    {note.title}
                  </span>
                  {note.isShared && (
                    <div
                      className="absolute top-2 right-2 text-blue-500"
                      title={t("tooltips.shared")}
                    >
                      <Users className="w-3.5 h-3.5" />
                    </div>
                  )}
                </>
              </ConditionChecker>

              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center justify-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                {note.role !== "view" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={e => {
                      e.stopPropagation();
                      onAddChild();
                    }}
                    title={t("tooltips.addChild")}
                  >
                    <Plus />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                    >
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    onClick={e => e.stopPropagation()}
                  >
                    {menuActions.length === 0 ? (
                      <DropdownMenuItem
                        disabled
                        className="text-muted-foreground italic"
                      >
                        {t("contextMenu.noActions")}
                      </DropdownMenuItem>
                    ) : (
                      menuActions.map((action, idx) => {
                        const showSeparator =
                          action.variant === "destructive" && idx > 0;
                        return (
                          <React.Fragment key={action.id}>
                            {showSeparator && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              variant={action.variant}
                              onClick={action.onClick}
                            >
                              {action.icon}
                              {action.label}
                            </DropdownMenuItem>
                          </React.Fragment>
                        );
                      })
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menuActions.length === 0 ? (
            <ContextMenuItem disabled className="text-muted-foreground italic">
              {t("contextMenu.noActions")}
            </ContextMenuItem>
          ) : (
            menuActions.map((action, idx) => {
              const showSeparator = action.variant === "destructive" && idx > 0;
              return (
                <React.Fragment key={action.id}>
                  {showSeparator && <ContextMenuSeparator />}
                  <ContextMenuItem
                    variant={action.variant}
                    onClick={action.onClick}
                  >
                    {action.icon}
                    {action.label}
                  </ContextMenuItem>
                </React.Fragment>
              );
            })
          )}
        </ContextMenuContent>
      </ContextMenu>
      {!isTemp && (
        <ShareDialog
          noteId={note._id}
          open={isShareOpen}
          onOpenChange={setIsShareOpen}
        />
      )}
    </div>
  );
}
