"use client";

import { Id } from "@/convex/_generated/dataModel";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useParams } from "next/navigation";
import { NoteTree } from "@/lib/treeUtils";
export type { NoteTree };
import { useNoteMutations } from "@/hooks/useNoteMutations";

const findNoteById = (noteId: Id<"notes">, note: NoteTree): NoteTree | null => {
  if (note._id === noteId) return note;
  if (!note.childNotes?.length) return null;

  for (const childNote of note.childNotes) {
    const found = findNoteById(noteId, childNote);
    if (found) return found;
  }
  return null;
};

interface Action {
  undo: () => void;
  redo: () => void;
}

interface TreeContextType {
  tree: NoteTree | null;
  selectedNote: NoteTree | null;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  onSelectNote: (
    note: NoteTree,
    getCurrentEditorContent?: () => string | null,
  ) => void;
  onUpdateNoteTitle: (noteId: Id<"notes">, newTitle: string) => void;
  onUpdateNoteContent: (newContent: string) => void;
  onAddChildNote: (
    parentId: Id<"notes">,
    newNoteTitle: string,
    getCurrentEditorContent?: () => string | null,
  ) => void;
  onDeleteNote: (noteId: Id<"notes">) => void;
  onDuplicateNote: (noteId: Id<"notes">) => void;
  onUpdateChildNotesOrder: (
    parentId: Id<"notes">,
    orderedChildIds: Id<"notes">[],
  ) => void;
  onMoveNote: (
    noteId: Id<"notes">,
    fromParentId: Id<"notes">,
    toParentId: Id<"notes">,
    index?: number,
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const TreeContext = createContext<TreeContextType>({
  tree: null,
  selectedNote: null,
  isDrawerOpen: false,
  setIsDrawerOpen: () => {},
  onSelectNote: () => {},
  onUpdateNoteTitle: () => {},
  onUpdateNoteContent: () => {},
  onAddChildNote: () => {},
  onDeleteNote: () => {},
  onDuplicateNote: () => {},
  onUpdateChildNotesOrder: () => {},
  onMoveNote: () => {},
  undo: () => {},
  redo: () => {},
  canUndo: false,
  canRedo: false,
});

export const useTreeContext = (): TreeContextType => {
  const context = useContext(TreeContext);
  if (!context)
    throw new Error("useTreeContext must be used within a TreeProvider");
  return context;
};

interface TreeProviderProps {
  children: ReactNode;
}

export function TreeProvider({ children }: Readonly<TreeProviderProps>) {
  const params = useParams();
  const noteId = params.id as Id<"notes">;
  const [selectedNoteId, setSelectedNoteId] = useState<Id<"notes">>(noteId);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [history, setHistory] = useState<{
    undoStack: Action[];
    redoStack: Action[];
  }>({ undoStack: [], redoStack: [] });

  const pushAction = useCallback((action: Action) => {
    setHistory(prev => ({
      undoStack: [...prev.undoStack, action],
      redoStack: [],
    }));
  }, []);

  const { data: tree } = useQuery(
    convexQuery(api.notes.getTreeById, { id: noteId, deep: 10 }),
  );

  const { mutate: updateNoteContent } = useMutation({
    mutationFn: useConvexMutation(api.notes.updateNoteContent),
  });

  const { mutate: duplicateNote } = useMutation({
    mutationFn: useConvexMutation(api.notes.duplicateNote),
  });

  const {
    updateNoteTitle,
    createNote,
    deleteNote,
    updateChildNotes,
    moveNote,
  } = useNoteMutations(noteId, setSelectedNoteId);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.undoStack.length === 0) return prev;
      const nextUndoStack = [...prev.undoStack];
      const action = nextUndoStack.pop()!;
      action.undo();
      return {
        undoStack: nextUndoStack,
        redoStack: [...prev.redoStack, action],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(prev => {
      if (prev.redoStack.length === 0) return prev;
      const nextRedoStack = [...prev.redoStack];
      const action = nextRedoStack.pop()!;
      action.redo();
      return {
        undoStack: [...prev.undoStack, action],
        redoStack: nextRedoStack,
      };
    });
  }, []);

  const canUndo = history.undoStack.length > 0;
  const canRedo = history.redoStack.length > 0;

  // Keyboard shortcut event listener for Ctrl+Z / Ctrl+Y (or Command+Z / Command+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Let the browser handle standard text editing undo/redo
        return;
      }

      const isZ = e.key.toLowerCase() === "z";
      const isY = e.key.toLowerCase() === "y";

      if ((e.ctrlKey || e.metaKey) && isZ && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (isY || (e.shiftKey && isZ))) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  const selectedNote = useMemo(() => {
    if (!tree) return null;
    return findNoteById(selectedNoteId, tree as unknown as NoteTree);
  }, [tree, selectedNoteId]);

  const contextValue = useMemo(
    () => ({
      tree: tree as unknown as NoteTree,
      selectedNote,
      isDrawerOpen,
      setIsDrawerOpen,
      onSelectNote: (
        note: NoteTree,
        getCurrentEditorContent?: () => string | null,
      ) => {
        setIsDrawerOpen(true);
        if (selectedNoteId === note._id) return;

        if (
          selectedNote &&
          selectedNote.role !== "view" &&
          getCurrentEditorContent
        ) {
          const currentContent = getCurrentEditorContent();
          if (currentContent) {
            const oldContent =
              typeof selectedNote.content === "string"
                ? selectedNote.content
                : JSON.stringify(selectedNote.content || {});
            if (currentContent !== oldContent) {
              updateNoteContent({
                id: selectedNote._id,
                content: currentContent,
              });
            }
          }
        }

        setSelectedNoteId(note._id);
      },
      onUpdateNoteTitle: (noteId: Id<"notes">, newTitle: string) => {
        if (!selectedNote) return;
        const currentTree = tree as unknown as NoteTree;
        const note = currentTree ? findNoteById(noteId, currentTree) : null;
        const originalTitle = note?.title || "";
        if (originalTitle === newTitle) return;

        pushAction({
          undo: () => updateNoteTitle({ id: noteId, title: originalTitle }),
          redo: () => updateNoteTitle({ id: noteId, title: newTitle }),
        });

        updateNoteTitle({
          id: noteId,
          title: newTitle,
        });
      },
      onUpdateNoteContent: (newContent: string) => {
        if (!selectedNote) return;
        updateNoteContent({
          id: selectedNote._id,
          content: newContent,
        });
      },
      onAddChildNote: (
        parentId: Id<"notes">,
        newNoteTitle: string,
        getCurrentEditorContent?: () => string | null,
      ) => {
        if (selectedNote && getCurrentEditorContent) {
          const currentContent = getCurrentEditorContent();
          if (currentContent) {
            updateNoteContent({
              id: selectedNote._id,
              content: currentContent,
            });
          }
        }

        // Duplication or Creation clears history to prevent references to non-existent temporary states
        setHistory({ undoStack: [], redoStack: [] });

        createNote({
          title: newNoteTitle,
          content: "",
          parentNote: parentId,
        });
      },
      onDeleteNote: (noteId: Id<"notes">) => {
        const currentTree = tree as unknown as NoteTree;
        const noteToDelete = currentTree
          ? findNoteById(noteId, currentTree)
          : null;

        if (noteToDelete) {
          // If the selected note is the one being deleted OR one of its descendants
          const isSelectedInBranch = !!findNoteById(
            selectedNoteId,
            noteToDelete,
          );

          if (isSelectedInBranch) {
            if (noteToDelete.parentNote) {
              setSelectedNoteId(noteToDelete.parentNote);
            } else if (currentTree && currentTree._id !== noteId) {
              setSelectedNoteId(currentTree._id);
            }
          }
        }

        // Destructive delete clears history
        setHistory({ undoStack: [], redoStack: [] });

        deleteNote({
          id: noteId,
        });
      },
      onDuplicateNote: (noteId: Id<"notes">) => {
        setHistory({ undoStack: [], redoStack: [] });
        duplicateNote({
          id: noteId,
        });
      },
      onUpdateChildNotesOrder: (
        parentId: Id<"notes">,
        orderedChildIds: Id<"notes">[],
      ) => {
        const currentTree = tree as unknown as NoteTree;
        const parentNote = currentTree
          ? findNoteById(parentId, currentTree)
          : null;
        const originalChildIds = parentNote?.childNotes?.map(c => c._id) || [];

        pushAction({
          undo: () =>
            updateChildNotes({ id: parentId, childNotes: originalChildIds }),
          redo: () =>
            updateChildNotes({ id: parentId, childNotes: orderedChildIds }),
        });

        updateChildNotes({
          id: parentId,
          childNotes: orderedChildIds,
        });
      },
      onMoveNote: (
        noteId: Id<"notes">,
        fromParentId: Id<"notes">,
        toParentId: Id<"notes">,
        index?: number,
      ) => {
        const currentTree = tree as unknown as NoteTree;
        const parentNote = currentTree
          ? findNoteById(fromParentId, currentTree)
          : null;
        const originalIndex =
          parentNote?.childNotes?.findIndex(c => c._id === noteId) ?? 0;

        pushAction({
          undo: () =>
            moveNote({
              id: noteId,
              from: toParentId,
              to: fromParentId,
              index: originalIndex,
            }),
          redo: () =>
            moveNote({ id: noteId, from: fromParentId, to: toParentId, index }),
        });

        moveNote({
          id: noteId,
          from: fromParentId,
          to: toParentId,
          index,
        });
      },
      undo,
      redo,
      canUndo,
      canRedo,
    }),
    [
      tree,
      selectedNote,
      selectedNoteId,
      isDrawerOpen,
      setIsDrawerOpen,
      updateNoteTitle,
      updateNoteContent,
      createNote,
      deleteNote,
      duplicateNote,
      updateChildNotes,
      moveNote,
      undo,
      redo,
      canUndo,
      canRedo,
      pushAction,
    ],
  );

  return (
    <TreeContext.Provider value={contextValue}>{children}</TreeContext.Provider>
  );
}
