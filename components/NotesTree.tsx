import { useState, useRef, useCallback, useEffect } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "./ui/button";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import ConditionChecker from "./helpers/ConditionChecker";
import { Id } from "@/convex/_generated/dataModel";
import { NoteTree, useTreeContext } from "@/providers/TreeProvider";
import { useEditorContext } from "@/providers/EditorProvider";
import { Skeleton } from "./ui/skeleton";
import { NoteCard } from "./NoteCard";
import { NewNoteCard } from "./NewNoteCard";
import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";
import {
  DragDropProvider,
  PointerSensor,
  useDragOperation,
  useDroppable,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "@/lib/utils";

const customSensors = [
  PointerSensor.configure({
    activationConstraints: event => {
      if (event.pointerType === "touch") {
        return [
          new PointerActivationConstraints.Delay({
            value: 250,
            tolerance: 10,
          }),
        ];
      }
      return [
        new PointerActivationConstraints.Distance({
          value: 5,
        }),
      ];
    },
    preventActivation: event => {
      const target = event.target as Element;
      return !!(
        target.closest("button") ||
        target.closest("input") ||
        target.closest("textarea") ||
        target.closest("[role='menu']") ||
        target.closest("[role='menuitem']")
      );
    },
  }),
];

const findNoteInTree = (
  noteId: Id<"notes">,
  root: NoteTree,
): NoteTree | null => {
  if (root._id === noteId) return root;
  if (!root.childNotes?.length) return null;
  for (const child of root.childNotes) {
    const found = findNoteInTree(noteId, child);
    if (found) return found;
  }
  return null;
};

const isSelfOrDescendantOfDragged = (
  noteId: Id<"notes">,
  draggedId: Id<"notes"> | undefined,
  tree: NoteTree | null | undefined,
): boolean => {
  if (!draggedId || !tree) return false;
  if (noteId === draggedId) return true;
  const draggedSubtree = findNoteInTree(draggedId, tree);
  if (!draggedSubtree) return false;
  return findNoteInTree(noteId, draggedSubtree) !== null;
};

const getTreeStateKey = (note: NoteTree | null | undefined): string => {
  if (!note) return "";
  const childIds = note.childNotes?.map(c => c?._id).filter(Boolean) || [];
  const childrenStr = childIds.join(",");
  const subTreeStr = note.childNotes
    ? note.childNotes.map(c => getTreeStateKey(c)).join("|")
    : "";
  return `${note._id}:${childrenStr}[${subTreeStr}]`;
};

interface CustomCollisionDetectorInput {
  dragOperation: {
    position: {
      current: { x: number; y: number } | null;
    };
  };
  droppable: {
    id: string | number;
    shape?: {
      center: { x: number; y: number };
      containsPoint: (point: { x: number; y: number }) => boolean;
      boundingRectangle: {
        width: number;
        height: number;
        left: number;
        right: number;
        top: number;
        bottom: number;
      };
    } | null;
    data?: {
      parentId?: string;
      hasChildren?: boolean;
    };
  };
}

const customCollisionDetection = ({
  dragOperation,
  droppable,
}: CustomCollisionDetectorInput) => {
  const pointerCoordinates = dragOperation.position.current;
  if (!pointerCoordinates || !droppable.shape) {
    return null;
  }

  // Check if pointer is inside the droppable target shape (NoteCard)
  const isInside = droppable.shape.containsPoint(pointerCoordinates);

  // Calculate distance between pointer and droppable center
  const dx = droppable.shape.center.x - pointerCoordinates.x;
  const dy = droppable.shape.center.y - pointerCoordinates.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;

  const targetIdStr = String(droppable.id);
  const isCard =
    !targetIdStr.startsWith("empty-placeholder-") &&
    targetIdStr !== "root-droppable";

  if (isInside) {
    if (isCard && droppable.data?.hasChildren === false) {
      const rect = droppable.shape.boundingRectangle;
      const relativeX = (pointerCoordinates.x - rect.left) / rect.width;

      // If cursor is in the middle 70% of the card, treat it as hovering the child placeholder
      if (relativeX >= 0.15 && relativeX <= 0.85) {
        return {
          id: `empty-placeholder-${droppable.id}`,
          value: 10000 / distance, // prioritize items the cursor is directly over
          type: 2, // PointerIntersection
          priority: 3, // High
        };
      }
    }

    return {
      id: droppable.id,
      value: 10000 / distance, // prioritize items the cursor is directly over
      type: 2, // PointerIntersection
      priority: 3, // High
    };
  }

  return {
    id: droppable.id,
    value: 1 / distance,
    type: 0, // Collision
    priority: 2, // Normal
  };
};

interface TreeSortableBranchProps {
  id: Id<"notes">;
  index: number;
  parentId: Id<"notes">;
  hasChildren?: boolean;
  className?: string;
  disabled?: boolean;
  children: (
    handleRef: (element: Element | null) => void,
    targetRef: (element: Element | null) => void,
  ) => React.ReactNode;
}

function TreeSortableBranch({
  id,
  index,
  parentId,
  hasChildren,
  className,
  disabled,
  children,
}: TreeSortableBranchProps) {
  const { ref, handleRef, targetRef, isDragging } = useSortable({
    id,
    index,
    group: `group-${parentId}`,
    data: {
      parentId,
      hasChildren,
    },
    disabled,
    collisionDetector: customCollisionDetection as unknown as undefined,
    plugins: [],
  });

  return (
    <div
      ref={ref}
      className={cn(
        "tree-child relative flex flex-col items-center",
        className,
        isDragging && "opacity-50 scale-95 z-20",
      )}
    >
      {children(handleRef, targetRef)}
    </div>
  );
}

export default function NotesTree() {
  const t = useTranslations("NotesTree");
  const tNotes = useTranslations("Notes");
  const router = useRouter();
  const leaveShareMutation = useMutation(api.notes.removeShare);
  const {
    tree,
    selectedNote,
    onAddChildNote,
    onDeleteNote,
    onUpdateChildNotesOrder,
    onMoveNote,
  } = useTreeContext();

  useHeaderConfig({
    title: tree?.title || "",
  });
  const { getCurrentContent } = useEditorContext();
  const { source, target } = useDragOperation();
  const isDraggingActive = !!source;

  const { ref: rootDroppableRef } = useDroppable({
    id: (tree?._id ?? "root-droppable") as string,
    data: {
      hasChildren: !!(tree?.childNotes && tree.childNotes.length > 0),
    },
    collisionDetector: customCollisionDetection as unknown as undefined,
  });

  const [hoveredNoteId, setHoveredNoteId] = useState<Id<"notes"> | null>(null);

  useEffect(() => {
    if (!isDraggingActive || !target) {
      setHoveredNoteId(null);
      return;
    }
    const targetIdStr = String(target.id);
    const noteId = (
      targetIdStr.startsWith("empty-placeholder-")
        ? targetIdStr.replace("empty-placeholder-", "")
        : targetIdStr
    ) as Id<"notes">;

    const targetNote = noteId && tree ? findNoteInTree(noteId, tree) : null;

    if (
      noteId &&
      targetNote?.role !== "view" &&
      !isSelfOrDescendantOfDragged(
        noteId,
        source?.id as Id<"notes"> | undefined,
        tree,
      )
    ) {
      setHoveredNoteId(noteId);
    } else {
      setHoveredNoteId(null);
    }
  }, [target, isDraggingActive, source?.id, tree]);

  const [dropIndicator, setDropIndicator] = useState<{
    noteId: Id<"notes">;
    position: "before" | "after" | "child";
  } | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<Id<"notes"> | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<Id<"notes"> | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedCardRef = useRef<HTMLDivElement | null>(null);

  const scrollToSelected = useCallback(() => {
    const container = scrollContainerRef.current;
    const card = selectedCardRef.current;
    if (!container || !card) return;

    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    const scrollLeft =
      container.scrollLeft +
      (cardRect.left - containerRect.left) -
      containerRect.width / 2 +
      cardRect.width / 2;

    const scrollTop =
      container.scrollTop +
      (cardRect.top - containerRect.top) -
      containerRect.height / 2 +
      cardRect.height / 2;

    container.scrollTo({
      left: scrollLeft,
      top: scrollTop,
      behavior: "smooth",
    });
  }, []);

  // Auto-center on selection change
  useEffect(() => {
    scrollToSelected();
  }, [selectedNote?._id, scrollToSelected]);

  const handleSelectedRef = useCallback((el: HTMLDivElement | null) => {
    selectedCardRef.current = el;
  }, []);

  const handleStartAddingNote = (noteId: Id<"notes">) => {
    setEditingNoteId(noteId);
  };

  const renderNote = (
    note: NoteTree,
    index: number,
    handleRef?: (element: Element | null) => void,
    targetRef?: (element: Element | null) => void,
  ) => {
    const hasChildren = note.childNotes && note.childNotes.length > 0;
    const isEditing = editingNoteId === note._id;
    const isDraggedOverEligible =
      isDraggingActive && hoveredNoteId === note._id;
    const showChildrenSection =
      hasChildren || isEditing || isDraggedOverEligible;

    const isIndicatorActive = dropIndicator?.noteId === note._id;
    const isBefore = isIndicatorActive && dropIndicator?.position === "before";
    const isAfter = isIndicatorActive && dropIndicator?.position === "after";
    const isNesting = isIndicatorActive && dropIndicator?.position === "child";

    return (
      <div
        className={cn(
          "flex flex-col items-center relative",
          showChildrenSection ? "gap-8" : "gap-0",
        )}
      >
        <div className="flex flex-col items-center relative group/node">
          {isBefore && (
            <div className="absolute -left-4 top-0 w-1 h-20 bg-primary rounded-full shadow-[0_0_8px_var(--color-primary)] z-30" />
          )}

          <NoteCard
            note={note}
            isRoot={note._id === tree?._id}
            onAddChild={() => handleStartAddingNote(note._id)}
            onDelete={() => setNoteToDelete(note._id)}
            onRef={handleSelectedRef}
            handleRef={handleRef as (el: HTMLDivElement | null) => void}
            targetRef={targetRef as (el: HTMLDivElement | null) => void}
            isNestingHovered={isNesting}
          />

          {isAfter && (
            <div className="absolute -right-4 top-0 w-1 h-20 bg-primary rounded-full shadow-[0_0_8px_var(--color-primary)] z-30" />
          )}

          {/* Vertical line to children anchor */}
          {showChildrenSection && <div className="w-px h-8 bg-border/60" />}
        </div>

        {/* Children container: always rendered in DOM, collapsed/hidden if not needed */}
        <div
          className={cn(
            "tree-children flex gap-8 relative",
            !showChildrenSection && "hidden pointer-events-none",
          )}
        >
          {note.childNotes?.map((childNote, idx) => {
            if (!childNote || !childNote._id || !childNote.title) return null;
            return (
              <TreeSortableBranch
                key={childNote._id}
                id={childNote._id}
                index={idx}
                parentId={note._id}
                disabled={childNote.role === "view"}
                hasChildren={
                  !!(childNote.childNotes && childNote.childNotes.length > 0)
                }
              >
                {(sortableHandleRef, sortableTargetRef) =>
                  renderNote(
                    childNote,
                    idx,
                    sortableHandleRef,
                    sortableTargetRef,
                  )
                }
              </TreeSortableBranch>
            );
          })}

          {/* Empty child drop target: always rendered in JSX if no children, collapsed if not active/eligible */}
          {!hasChildren && !isEditing && (
            <TreeSortableBranch
              key={`empty-placeholder-${note._id}`}
              id={`empty-placeholder-${note._id}` as Id<"notes">}
              index={0}
              parentId={note._id}
              className={cn(
                !isDraggedOverEligible && "hidden pointer-events-none",
              )}
            >
              {(_, sortableTargetRef) => (
                <div
                  ref={sortableTargetRef as (el: HTMLDivElement | null) => void}
                  className="w-45 h-20 border-2 border-dashed border-primary/30 rounded-lg flex items-center justify-center bg-primary/5 hover:bg-primary/10 hover:border-primary/50 opacity-70"
                >
                  <span className="text-xs text-muted-foreground font-medium">
                    {t("dropHere")}
                  </span>
                </div>
              )}
            </TreeSortableBranch>
          )}

          {editingNoteId === note._id && (
            <div className="tree-child relative flex flex-col items-center">
              <NewNoteCard
                onSave={title => {
                  if (title.trim()) {
                    onAddChildNote(note._id, title, getCurrentContent);
                  }
                  setEditingNoteId(null);
                }}
                onCancel={() => setEditingNoteId(null)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const treeKey = getTreeStateKey(tree);

  return (
    <div className="relative w-full h-full">
      <div
        ref={scrollContainerRef}
        className="relative w-full h-full overflow-auto scrollbar-thin"
      >
        <DragDropProvider
          sensors={customSensors}
          onDragStart={() => {
            setTimeout(() => {
              setDropIndicator(null);
            }, 0);
          }}
          onDragMove={({ operation }) => {
            setTimeout(() => {
              const { source, target } = operation;
              if (!source || !target) {
                setDropIndicator(null);
                return;
              }

              const targetIdStr = String(target.id);
              if (targetIdStr.startsWith("empty-placeholder-")) {
                const noteId = targetIdStr.replace(
                  "empty-placeholder-",
                  "",
                ) as Id<"notes">;
                const targetNote = tree ? findNoteInTree(noteId, tree) : null;
                if (targetNote && targetNote.role !== "view") {
                  setDropIndicator({ noteId, position: "child" });
                } else {
                  setDropIndicator(null);
                }
              } else {
                const targetId = target.id as Id<"notes">;
                if (targetIdStr === "root-droppable") {
                  if (tree && tree.role !== "view") {
                    setDropIndicator({
                      noteId: tree._id as Id<"notes">,
                      position: "child",
                    });
                  } else {
                    setDropIndicator(null);
                  }
                  return;
                }

                if (target.element && operation.position.current) {
                  const rect = target.element.getBoundingClientRect();
                  const relativeX =
                    (operation.position.current.x - rect.left) / rect.width;

                  const targetNote = tree
                    ? findNoteInTree(targetId, tree)
                    : null;
                  const parentId = target.data.parentId as
                    | Id<"notes">
                    | undefined;
                  const parentNote =
                    parentId && tree ? findNoteInTree(parentId, tree) : null;

                  if (relativeX < 0.15) {
                    if (parentNote && parentNote.role !== "view") {
                      setDropIndicator({
                        noteId: targetId,
                        position: "before",
                      });
                    } else {
                      setDropIndicator(null);
                    }
                  } else if (relativeX > 0.85) {
                    if (parentNote && parentNote.role !== "view") {
                      setDropIndicator({ noteId: targetId, position: "after" });
                    } else {
                      setDropIndicator(null);
                    }
                  } else {
                    if (targetNote && targetNote.role !== "view") {
                      setDropIndicator({ noteId: targetId, position: "child" });
                    } else {
                      setDropIndicator(null);
                    }
                  }
                }
              }
            }, 0);
          }}
          onDragEnd={({ operation }) => {
            setTimeout(() => {
              setDropIndicator(null);
              const { source, target } = operation;
              if (!source || !target || !tree) return;

              const draggedId = source.id as Id<"notes">;
              const oldParentId = source.data.parentId as Id<"notes">;

              if (String(target.id).startsWith("empty-placeholder-")) {
                const newParentId = String(target.id).replace(
                  "empty-placeholder-",
                  "",
                ) as Id<"notes">;
                const parentNote = tree
                  ? findNoteInTree(newParentId, tree)
                  : null;
                if (!parentNote || parentNote.role === "view") return;

                if (oldParentId !== newParentId) {
                  onMoveNote(draggedId, oldParentId, newParentId, 0);
                }
              } else {
                // Dropped on a card (sibling sortable or other note card)
                const targetId = target.id as Id<"notes">;
                const newParentId = target.data.parentId as
                  | Id<"notes">
                  | undefined;

                if (!newParentId) return;

                // Find target index in the parent's children list
                const parentNote = findNoteInTree(newParentId, tree);
                if (
                  !parentNote ||
                  !parentNote.childNotes ||
                  parentNote.role === "view"
                )
                  return;

                const childIds = parentNote.childNotes.map(c => c._id);
                const targetIndex = childIds.indexOf(targetId);
                if (targetIndex === -1) return;

                // Calculate relative pointer position to decide whether to insert before or after target
                let insertAfter = false;
                if (operation.position.current && target.element) {
                  const rect = target.element.getBoundingClientRect();
                  const relativeX =
                    (operation.position.current.x - rect.left) / rect.width;
                  if (relativeX > 0.5) {
                    insertAfter = true;
                  }
                }

                const newIndex = insertAfter ? targetIndex + 1 : targetIndex;

                if (oldParentId !== newParentId) {
                  onMoveNote(draggedId, oldParentId, newParentId, newIndex);
                } else {
                  // Sibling sorting under same parent
                  const initialIndex = childIds.indexOf(draggedId);
                  if (initialIndex === -1 || initialIndex === newIndex) return;

                  const updatedIds = [...childIds];
                  const [movedId] = updatedIds.splice(initialIndex, 1);

                  // Adjust index if we spliced before the insert target
                  let adjustedNewIndex = newIndex;
                  if (initialIndex < newIndex) {
                    adjustedNewIndex = newIndex - 1;
                  }

                  updatedIds.splice(adjustedNewIndex, 0, movedId);
                  onUpdateChildNotesOrder(newParentId, updatedIds);
                }
              }
            }, 0);
          }}
        >
          <div
            key={treeKey}
            className="min-w-full inline-flex justify-center items-start p-4"
          >
            <ConditionChecker condition={!tree}>
              <div className="flex flex-col gap-8 items-center">
                <Skeleton className="w-48 h-16 rounded-lg" />
                <div className="flex gap-4">
                  <Skeleton className="w-40 h-14 rounded-lg" />
                  <Skeleton className="w-40 h-14 rounded-lg" />
                </div>
              </div>
            </ConditionChecker>
            {tree ? renderNote(tree, 0, undefined, rootDroppableRef) : null}
          </div>
        </DragDropProvider>
      </div>
      {selectedNote && (
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToSelected}
          className="absolute bottom-4 right-4 z-10 h-9 w-9 rounded-full shadow-lg backdrop-blur-sm bg-background/80 border-border/60 hover:bg-accent hover:scale-110 transition-all duration-200"
          title={t("recenter")}
        >
          <Crosshair className="h-4 w-4" />
        </Button>
      )}
      {(() => {
        const isLeaving = noteToDelete === tree?._id && tree?.isShared;

        return (
          <AlertDialog
            open={noteToDelete !== null}
            onOpenChange={open => !open && setNoteToDelete(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isLeaving
                    ? tNotes("leaveConfirmTitle")
                    : t("deleteConfirmTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isLeaving
                    ? tNotes("leaveConfirmDesc")
                    : t("deleteConfirmDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setNoteToDelete(null)}>
                  {t("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={async () => {
                    if (noteToDelete) {
                      if (isLeaving && tree?.shareId) {
                        try {
                          await leaveShareMutation({ shareId: tree.shareId });
                          router.push("/notes");
                        } catch (err) {
                          console.error(err);
                        }
                      } else {
                        onDeleteNote(noteToDelete);
                      }
                      setNoteToDelete(null);
                    }
                  }}
                >
                  {isLeaving ? tNotes("leave") : t("continue")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}
    </div>
  );
}
