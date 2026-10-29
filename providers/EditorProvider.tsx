import { Editor, JSONContent } from "@tiptap/core";
import { Content, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDebouncedCallback } from "use-debounce";
import { useTreeContext } from "./TreeProvider";
import { useTranslations } from "next-intl";
import { GhostText } from "@/lib/editor/ghostText";
import { useAutocompleteBridge } from "@/lib/editor/useAutocompleteBridge";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import usePresence, { type PresenceState } from "@convex-dev/presence/react";
import { useUser } from "@clerk/nextjs";
import {
  CollaborativeCursors,
  collaborativeCursorsKey,
  getUserColor,
  type RemoteUserCursor,
} from "@/lib/editor/collaborativeCursors";

type saveStatusType = "idle" | "unsaved" | "saving" | "success" | "error";

export type PreviewVersion = {
  _id: string;
  content: string;
  title: string;
  createdAt: number;
  isPreRestore: boolean;
  author: { name: string | null; avatarUrl: string | null } | null;
};

export type HoveredCollaborator = {
  userId: string;
  activeNoteId: string;
  color: string;
};

interface EditorContextType {
  editor: Editor | null;
  saveStatus: saveStatusType;
  getCurrentContent: () => string | null;
  previewVersion: PreviewVersion | null;
  enterPreview: (version: PreviewVersion) => void;
  exitPreview: (contentOverride?: string) => void;
  presenceList?: PresenceState[];
  treePresenceList?: PresenceState[];
  hoveredCollaborator: HoveredCollaborator | null;
  setHoveredCollaborator: (collab: HoveredCollaborator | null) => void;
}

const EditorContext = createContext<EditorContextType>({
  editor: null,
  saveStatus: "idle",
  getCurrentContent: () => null,
  previewVersion: null,
  enterPreview: () => {},
  exitPreview: () => {},
  presenceList: undefined,
  treePresenceList: undefined,
  hoveredCollaborator: null,
  setHoveredCollaborator: () => {},
});

function parseNoteContent(raw: unknown): Content {
  let content: Content = "";
  try {
    if (raw && typeof raw === "string") {
      if (raw.trim() === "") {
        content = "";
      } else {
        content = JSON.parse(raw) as Content;
      }
    } else if (raw) {
      content = raw as Content;
    }
  } catch (error) {
    console.warn("Failed to parse note content, using empty content:", error);
    content = "";
  }
  return content;
}

export const useEditorContext = (): EditorContextType => {
  const context = useContext(EditorContext);
  if (!context)
    throw new Error("useEditorContext must be used within an EditorProvider");
  return context;
};

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: Readonly<EditorProviderProps>) {
  const t = useTranslations("Editor");
  const { selectedNote, onUpdateNoteContent, rootNoteId } = useTreeContext();
  const treeRoomId = rootNoteId ?? selectedNote?._id ?? "";

  const [saveStatus, setSaveStatus] = useState<saveStatusType>("idle");
  const lastNoteIdRef = useRef<string | undefined>(undefined);
  const [hoveredCollaborator, setHoveredCollaborator] =
    useState<HoveredCollaborator | null>(null);

  const [previewVersion, setPreviewVersion] = useState<PreviewVersion | null>(
    null,
  );
  const previewRef = useRef<PreviewVersion | null>(null);
  const latestContentRef = useRef<string | undefined>(selectedNote?.content);

  const initialContent: Content = parseNoteContent(selectedNote?.content);

  // Phase 21: premium ghost-text autocomplete (off unless the account turned
  // it on; a Free user never makes a request).
  const { options: autocomplete, enabled: autocompleteEnabled } =
    useAutocompleteBridge(selectedNote?._id);

  const sync = useTiptapSync(api.prosemirrorSync, selectedNote?._id ?? "");

  const { user } = useUser();
  const me = useQuery(api.users.me);
  const currentUserId = me?._id ?? user?.id ?? "";

  const treePresenceList = usePresence(
    api.presence,
    treeRoomId,
    currentUserId,
    10000,
  );

  const updateCursorMutation = useMutation(api.presence.updateCursor);

  // Filter tree presence to get collaborators active on the currently selected note
  const presenceList = useMemo(() => {
    if (!selectedNote?._id) return [];
    return (treePresenceList ?? []).filter(p => {
      if (!p.data || typeof p.data !== "object") return true;
      const data = p.data as { activeNoteId?: string };
      return !data.activeNoteId || data.activeNoteId === selectedNote._id;
    });
  }, [treePresenceList, selectedNote?._id]);

  // Sync active note presence across the tree room
  useEffect(() => {
    if (!treeRoomId) return;
    void updateCursorMutation({
      roomId: treeRoomId,
      activeNoteId: selectedNote?._id,
      cursor: undefined,
    });
  }, [treeRoomId, selectedNote?._id, updateCursorMutation]);

  const debouncedSendCursor = useDebouncedCallback(
    (from: number, to: number) => {
      if (!treeRoomId || previewRef.current) return;
      void updateCursorMutation({
        roomId: treeRoomId,
        activeNoteId: selectedNote?._id,
        cursor: { from, to },
      });
    },
    150,
    { maxWait: 400 },
  );

  const clearCursor = useCallback(() => {
    if (!treeRoomId) return;
    void updateCursorMutation({
      roomId: treeRoomId,
      activeNoteId: selectedNote?._id,
      cursor: undefined,
    });
  }, [treeRoomId, selectedNote?._id, updateCursorMutation]);

  // When a note is opened for the first time in prosemirrorSync, initialize it
  useEffect(() => {
    if (!sync.isLoading && sync.initialContent === null && selectedNote?._id) {
      const parsed = parseNoteContent(selectedNote.content);
      const doc =
        parsed && typeof parsed === "object" && "type" in parsed
          ? (parsed as JSONContent)
          : { type: "doc", content: [] };
      void sync.create(doc);
    }
  }, [
    sync.isLoading,
    sync.initialContent,
    selectedNote?._id,
    selectedNote?.content,
    sync,
  ]);

  const editor = useEditor(
    {
      content: initialContent,
      extensions: [
        StarterKit,
        ...(sync.extension ? [sync.extension] : []),
        CollaborativeCursors,
        Placeholder.configure({
          placeholder: t("placeholder"),
        }),
        Image,
        GhostText.configure(autocomplete),
      ],
      editorProps: {
        attributes: {
          class: "flex-1 overflow-y-auto border rounded-md p-4",
        },
      },
      onSelectionUpdate: ({ editor: ed }) => {
        if (previewRef.current) return;
        const { from, to } = ed.state.selection;
        debouncedSendCursor(from, to);
      },
      onBlur: () => {
        clearCursor();
      },
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
    },
    [selectedNote?._id, sync.extension, t],
  );

  // Sync remote collaborators' cursors into TipTap decorations
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const remoteUsers: RemoteUserCursor[] = (presenceList ?? [])
      .filter(
        p =>
          p.online &&
          p.userId !== currentUserId &&
          (!user?.id || p.userId !== user.id) &&
          p.data &&
          typeof p.data === "object" &&
          "cursor" in (p.data as Record<string, unknown>),
      )
      .map(p => {
        const data = p.data as { cursor?: { from: number; to: number } };
        return {
          userId: p.userId,
          name: p.name || t("collaborator"),
          color: getUserColor(p.userId),
          cursor: data.cursor,
        };
      })
      .filter(
        (
          u,
        ): u is RemoteUserCursor & {
          cursor: { from: number; to: number };
        } => Boolean(u.cursor),
      );

    const tr = editor.state.tr.setMeta(collaborativeCursorsKey, remoteUsers);
    editor.view.dispatch(tr);
  }, [presenceList, currentUserId, user?.id, editor, t]);

  // Clear cursor on note change or unmount
  useEffect(() => {
    return () => {
      clearCursor();
    };
  }, [selectedNote?._id, clearCursor]);

  // Clear cursor when tab/document is hidden, restore on focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearCursor();
      } else if (editor && !editor.isDestroyed && editor.isFocused) {
        const { from, to } = editor.state.selection;
        debouncedSendCursor(from, to);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [editor, clearCursor, debouncedSendCursor]);

  // Switching autocomplete off (here or on another device) drops a shown
  // suggestion and any pending request immediately.
  useEffect(() => {
    if (autocompleteEnabled || !editor || editor.isDestroyed) return;
    (
      editor.storage as unknown as
        | { ghostText?: { clear?: () => void } }
        | undefined
    )?.ghostText?.clear?.();
  }, [autocompleteEnabled, editor]);

  const saveContent = useCallback(
    async (content: Content) => {
      if (!selectedNote) return;
      if (selectedNote.role === "view") return; // Do not save if view-only
      if (previewRef.current) return; // Never save while previewing a version

      try {
        setSaveStatus("saving");

        onUpdateNoteContent(JSON.stringify(content));

        setSaveStatus("success");

        setTimeout(() => {
          setSaveStatus(currentStatus =>
            currentStatus === "success" ? "idle" : currentStatus,
          );
        }, 2000);
      } catch (error) {
        console.error("Failed to save note content", error);
        setSaveStatus("error");
      }
    },
    [selectedNote, onUpdateNoteContent],
  );

  const debouncedSave = useDebouncedCallback(saveContent, 3000);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (selectedNote?.role === "view") return; // Do not save if view-only
        if (previewRef.current) return; // Never save while previewing a version
        if (editor && !editor.isDestroyed && saveStatus === "unsaved") {
          debouncedSave.cancel();
          saveContent(editor.getJSON());
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, saveStatus, debouncedSave, saveContent, selectedNote?.role]);

  // Track the newest stored content (also while previewing) so exitPreview
  // can show it. Declared before the sync effect so it runs first.
  useEffect(() => {
    latestContentRef.current = selectedNote?.content;
  }, [selectedNote?._id, selectedNote?.content]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    debouncedSave.cancel();

    const isNoteChanged = lastNoteIdRef.current !== selectedNote?._id;
    lastNoteIdRef.current = selectedNote?._id;

    if (isNoteChanged) {
      setSaveStatus("idle");
      // The editor is re-created on note switch, so just drop preview state.
      previewRef.current = null;
      setPreviewVersion(null);
    }

    if (!selectedNote) {
      if (editor.getText() !== "") {
        editor.commands.setContent("");
      }
      return;
    }

    // While previewing, remote changes must not touch the editor.
    if (previewRef.current && !isNoteChanged) return;

    // When sync.extension is active, remote changes on the same note are
    // merged cleanly in real time via ProseMirror collab. Calling setContent
    // would clobber the user's cursor and local unsynced edits.
    if (!isNoteChanged && sync.extension) return;

    const content = parseNoteContent(latestContentRef.current);

    const currentJSON = JSON.stringify(editor.getJSON());
    const incomingJSON =
      typeof content === "string" ? content : JSON.stringify(content);

    if (currentJSON === incomingJSON) return;

    editor.commands.setContent(content, { emitUpdate: false });

    setSaveStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor,
    selectedNote?._id,
    selectedNote?.content,
    debouncedSave,
    previewVersion,
  ]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !selectedNote) return;

    const updateListener = ({ editor }: { editor: Editor }) => {
      if (previewRef.current) return; // Never save while previewing a version
      if (!editor.isEditable || selectedNote.role === "view") return; // Do not save if view-only
      setSaveStatus("unsaved");
      debouncedSave(editor.getJSON());
    };

    editor.on("update", updateListener);

    return () => {
      if (editor) {
        editor.off("update", updateListener);
      }
    };
  }, [editor, selectedNote, debouncedSave]);

  // Dynamically set editor editable status based on note role / permissions
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const isEditable = selectedNote
      ? selectedNote.role !== "view" && !previewVersion // view and previewing are read-only
      : false;
    if (editor.isEditable !== isEditable) {
      // Tiptap emits "update" by default, which would mark the note unsaved
      // and autosave right after leaving preview / restoring. Suppress it.
      editor.setEditable(isEditable, false);
    }
  }, [editor, selectedNote, selectedNote?.role, previewVersion]);

  const enterPreview = useCallback(
    (version: PreviewVersion) => {
      if (!editor || editor.isDestroyed) return;
      // Persist any pending edit first so nothing is lost / snapshotted late.
      debouncedSave.flush();
      previewRef.current = version;
      setPreviewVersion(version);
      editor.commands.setContent(parseNoteContent(version.content), {
        emitUpdate: false,
      });
    },
    [editor, debouncedSave],
  );

  const exitPreview = useCallback(
    (contentOverride?: string) => {
      previewRef.current = null;
      setPreviewVersion(null);
      if (contentOverride !== undefined) {
        latestContentRef.current = contentOverride;
      }
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(parseNoteContent(latestContentRef.current), {
          emitUpdate: false,
        });
        setSaveStatus("idle");
      }
    },
    [editor],
  );

  const getCurrentContent = useCallback(() => {
    if (previewRef.current) return null;
    if (!editor || editor.isDestroyed) return null;
    return JSON.stringify(editor.getJSON());
  }, [editor]);

  const contextValue = useMemo(
    () => ({
      editor,
      saveStatus,
      getCurrentContent,
      previewVersion,
      enterPreview,
      exitPreview,
      presenceList,
      treePresenceList,
      hoveredCollaborator,
      setHoveredCollaborator,
    }),
    [
      editor,
      saveStatus,
      getCurrentContent,
      previewVersion,
      enterPreview,
      exitPreview,
      presenceList,
      treePresenceList,
      hoveredCollaborator,
      setHoveredCollaborator,
    ],
  );

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
}
