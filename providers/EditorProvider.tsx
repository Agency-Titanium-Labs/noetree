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

interface EditorContextType {
  editor: Editor | null;
  saveStatus: saveStatusType;
  getCurrentContent: () => string | null;
}

const EditorContext = createContext<EditorContextType>({
  editor: null,
  saveStatus: "idle",
  getCurrentContent: () => null,
});

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

  let initialContent: Content = "";
  try {
    if (selectedNote?.content && typeof selectedNote.content === "string") {
      initialContent = JSON.parse(selectedNote.content) as Content;
    } else if (selectedNote?.content) {
      initialContent = selectedNote.content;
    }
  } catch (error) {
    console.warn("Failed to parse note content, using empty content:", error);
  }

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

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    debouncedSave.cancel();

    const isNoteChanged = lastNoteIdRef.current !== selectedNote?._id;
    lastNoteIdRef.current = selectedNote?._id;

    if (isNoteChanged) {
      setSaveStatus("idle");
    }

    if (!selectedNote) {
      if (editor.getText() !== "") {
        editor.commands.setContent("");
      }
      return;
    }

    let content = "";
    try {
      if (selectedNote.content && typeof selectedNote.content === "string") {
        if (selectedNote.content.trim() === "") {
          content = "";
        } else {
          content = JSON.parse(selectedNote.content);
        }
      } else if (selectedNote.content) {
        content = selectedNote.content;
      }
    } catch (error) {
      console.warn("Failed to parse note content, using empty content:", error);
      content = "";
    }

    const currentJSON = JSON.stringify(editor.getJSON());
    const incomingJSON =
      typeof content === "string" ? content : JSON.stringify(content);

    if (currentJSON === incomingJSON) return;

    editor.commands.setContent(content, { emitUpdate: false });

    setSaveStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selectedNote?._id, selectedNote?.content, debouncedSave]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !selectedNote) return;

    const updateListener = ({ editor }: { editor: Editor }) => {
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
      ? selectedNote.role !== "view" // owner, admin, and edit are editable; view is not
      : false;
    if (editor.isEditable !== isEditable) {
      editor.setEditable(isEditable);
    }
  }, [editor, selectedNote, selectedNote?.role]);

  const getCurrentContent = () => {
    if (!editor || editor.isDestroyed) return null;
    return JSON.stringify(editor.getJSON());
  };

  const contextValue = {
    editor,
    saveStatus,
    getCurrentContent,
  };

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
}
