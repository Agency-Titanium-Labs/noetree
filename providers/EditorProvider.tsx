import { Editor } from "@tiptap/core";
import { Content, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDebouncedCallback } from "use-debounce";
import { useTreeContext } from "./TreeProvider";
import { useTranslations } from "next-intl";

type saveStatusType = "idle" | "unsaved" | "saving" | "success" | "error";

export type PreviewVersion = {
  _id: string;
  content: string;
  title: string;
  createdAt: number;
  isPreRestore: boolean;
  author: { name: string | null; avatarUrl: string | null } | null;
};

interface EditorContextType {
  editor: Editor | null;
  saveStatus: saveStatusType;
  getCurrentContent: () => string | null;
  previewVersion: PreviewVersion | null;
  enterPreview: (version: PreviewVersion) => void;
  exitPreview: (contentOverride?: string) => void;
}

const EditorContext = createContext<EditorContextType>({
  editor: null,
  saveStatus: "idle",
  getCurrentContent: () => null,
  previewVersion: null,
  enterPreview: () => {},
  exitPreview: () => {},
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
  const { selectedNote, onUpdateNoteContent } = useTreeContext();

  const [saveStatus, setSaveStatus] = useState<saveStatusType>("idle");
  const lastNoteIdRef = useRef<string | undefined>(undefined);

  const [previewVersion, setPreviewVersion] = useState<PreviewVersion | null>(
    null,
  );
  const previewRef = useRef<PreviewVersion | null>(null);
  const latestContentRef = useRef<string | undefined>(selectedNote?.content);

  const initialContent: Content = parseNoteContent(selectedNote?.content);

  const editor = useEditor(
    {
      content: initialContent,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: t("placeholder"),
        }),
        Link,
        Image,
      ],
      editorProps: {
        attributes: {
          class: "flex-1 overflow-y-auto border rounded-md p-4",
        },
      },
      immediatelyRender: false,
    },
    [selectedNote?._id, t],
  );

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

  const getCurrentContent = () => {
    if (previewRef.current) return null;
    if (!editor || editor.isDestroyed) return null;
    return JSON.stringify(editor.getJSON());
  };

  const contextValue = {
    editor,
    saveStatus,
    getCurrentContent,
    previewVersion,
    enterPreview,
    exitPreview,
  };

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
}
