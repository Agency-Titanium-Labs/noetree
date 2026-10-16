"use client";

import { useEffect, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Content, Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { ConvexError } from "convex/values";
import { Eye, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDebouncedCallback } from "use-debounce";

import SharedHeader from "@/components/SharedHeader";
import SharedUnavailable from "@/components/SharedUnavailable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";

type SaveStatus = "idle" | "unsaved" | "saving" | "success" | "error";

interface SharedNoteData {
  title: string;
  content: string;
  role: "view" | "edit";
  canEdit: boolean;
  isAuthenticated: boolean;
}

function safeParse(raw: string): Content {
  try {
    if (!raw || raw.trim() === "") return "";
    return JSON.parse(raw) as Content;
  } catch {
    return "";
  }
}

export default function SharedNoteView({ token }: Readonly<{ token: string }>) {
  const t = useTranslations("SharedNote");
  const { data, isPending } = useQuery(
    convexQuery(api.shareLinks.getSharedNote, { token }),
  );

  if (isPending) {
    return (
      <>
        <SharedHeader
          badgeLabel={t("badgeView")}
          badgeIcon={<Eye className="size-4" />}
        />
        <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
          <Skeleton className="h-8 w-2/3" />
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </main>
      </>
    );
  }

  if (data === null || data === undefined) {
    return <SharedUnavailable />;
  }

  return <SharedNoteBody data={data} token={token} />;
}

function SharedNoteBody({
  data,
  token,
}: Readonly<{ data: SharedNoteData; token: string }>) {
  const t = useTranslations("SharedNote");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [revoked, setRevoked] = useState(false);
  const [href, setHref] = useState("");

  const editable = data.canEdit && !revoked;

  const editor = useEditor({
    extensions: [StarterKit, Link, Image],
    content: safeParse(data.content),
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "flex-1 overflow-y-auto border rounded-md p-4",
      },
    },
  });

  const saveMutation = useConvexMutation(
    api.shareLinks.updateSharedNoteContent,
  );

  const saveContent = async (json: Content) => {
    setSaveStatus("saving");
    try {
      await saveMutation({ token, content: JSON.stringify(json) });
      setSaveStatus("success");
    } catch (err) {
      if (
        err instanceof ConvexError &&
        (err.data === "LINK_INVALID" || err.data === "UNAUTHENTICATED")
      ) {
        setRevoked(true);
      } else {
        setSaveStatus("error");
      }
    }
  };

  const debouncedSave = useDebouncedCallback(saveContent, 3000);

  useEffect(() => {
    setHref(window.location.href);
  }, []);

  useEffect(() => {
    document.title = data.title || t("pageTitle");
  }, [data.title, t]);

  // Editable flips live after sign-in (D-09) or on revoke.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  // Apply remote content without clobbering local typing or echoing own saves.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editable && (saveStatus === "unsaved" || saveStatus === "saving")) {
      return;
    }
    const incoming = safeParse(data.content);
    const incomingJSON =
      typeof incoming === "string" ? incoming : JSON.stringify(incoming);
    if (JSON.stringify(editor.getJSON()) === incomingJSON) return;
    editor.commands.setContent(incoming, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, data.content]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const updateListener = ({ editor }: { editor: Editor }) => {
      if (!editor.isEditable) return;
      setSaveStatus("unsaved");
      debouncedSave(editor.getJSON());
    };
    editor.on("update", updateListener);
    return () => {
      editor.off("update", updateListener);
    };
  }, [editor, debouncedSave]);

  useEffect(() => {
    if (saveStatus !== "success") return;
    const id = setTimeout(() => {
      setSaveStatus(s => (s === "success" ? "idle" : s));
    }, 2000);
    return () => clearTimeout(id);
  }, [saveStatus]);

  if (revoked) {
    return <SharedUnavailable message={t("revokedEditError")} />;
  }

  const status =
    saveStatus === "saving"
      ? t("saving")
      : saveStatus === "success"
        ? t("saved")
        : saveStatus === "error"
          ? t("saveError")
          : undefined;

  return (
    <>
      <SharedHeader
        badgeLabel={data.role === "edit" ? t("badgeEdit") : t("badgeView")}
        badgeIcon={
          data.role === "edit" ? (
            <Pencil className="size-4" />
          ) : (
            <Eye className="size-4" />
          )
        }
        status={status}
      />
      {data.role === "edit" && !data.isAuthenticated && (
        <div className="sticky top-0 z-10 border-b bg-muted">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
            <p className="text-sm">{t("signInBanner")}</p>
            {href && (
              <SignInButton mode="modal" forceRedirectUrl={href}>
                <Button size="sm">{t("signInCta")}</Button>
              </SignInButton>
            )}
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-[32px] font-semibold leading-tight">
          {data.title || t("untitled")}
        </h1>
        <div className="mt-6">
          <EditorContent editor={editor} />
        </div>
      </main>
    </>
  );
}
