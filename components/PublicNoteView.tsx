"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Content, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapLink from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { FileText, Globe } from "lucide-react";
import { useTranslations } from "next-intl";

import SharedHeader from "@/components/SharedHeader";
import SharedUnavailable from "@/components/SharedUnavailable";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import CommentsButton from "@/components/CommentsButton";
import CommentsPanel from "@/components/CommentsPanel";
import { Link } from "@/i18n/routing";

interface PublicNoteData {
  _id: string;
  title: string;
  content: string;
  children: Array<{ _id: string; title: string }>;
}

function safeParse(raw: string): Content {
  try {
    if (!raw || raw.trim() === "") return "";
    return JSON.parse(raw) as Content;
  } catch {
    return "";
  }
}

export default function PublicNoteView({
  noteId,
}: Readonly<{ noteId: string }>) {
  const t = useTranslations("SharedNote");
  const { data, isPending } = useQuery(
    convexQuery(api.shareLinks.getPublicNote, { noteId }),
  );

  if (isPending) {
    return (
      <>
        <SharedHeader
          badgeLabel={t("badgePublic")}
          badgeIcon={<Globe className="size-4" />}
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

  return <PublicNoteBody key={data._id} data={data} />;
}

function PublicNoteBody({ data }: Readonly<{ data: PublicNoteData }>) {
  const t = useTranslations("SharedNote");
  const searchParams = useSearchParams();
  const commentsParam = searchParams.get("comments");
  const focusCommentId = searchParams.get("c");
  const [isCommentsOpen, setIsCommentsOpen] = useState(commentsParam === "1");
  const commentsTarget = useMemo(
    () => ({ kind: "note" as const, noteId: data._id as Id<"notes"> }),
    [data._id],
  );

  // Same-page notification clicks do not remount; re-open on param change.
  useEffect(() => {
    if (commentsParam === "1") setIsCommentsOpen(true);
  }, [commentsParam, focusCommentId]);

  const editor = useEditor({
    extensions: [StarterKit, TiptapLink, Image],
    content: safeParse(data.content),
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "flex-1 overflow-y-auto border rounded-md p-4",
      },
    },
  });

  useEffect(() => {
    document.title = data.title || t("pageTitle");
  }, [data.title, t]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = safeParse(data.content);
    const incomingJSON =
      typeof incoming === "string" ? incoming : JSON.stringify(incoming);
    if (JSON.stringify(editor.getJSON()) === incomingJSON) return;
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, data.content]);

  return (
    <>
      <SharedHeader
        badgeLabel={t("badgePublic")}
        badgeIcon={<Globe className="size-4" />}
        actions={
          <CommentsButton
            target={commentsTarget}
            isOpen={isCommentsOpen}
            onClick={() => setIsCommentsOpen(o => !o)}
          />
        }
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-[32px] font-semibold leading-tight">
          {data.title || t("untitled")}
        </h1>
        <div className="mt-6">
          <EditorContent editor={editor} />
        </div>
        {data.children.length > 0 && (
          <>
            <Separator className="mt-8" />
            <h2 className="mt-8 text-xl font-semibold">
              {t("childrenHeading")}
            </h2>
            <ul className="mt-4 flex flex-col gap-1">
              {data.children.map(child => (
                <li key={child._id}>
                  <Link
                    href={`/p/${child._id}`}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 hover:bg-muted"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {child.title || t("untitled")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <CommentsPanel
        target={commentsTarget}
        open={isCommentsOpen}
        onOpenChange={setIsCommentsOpen}
        focusCommentId={focusCommentId}
      />
    </>
  );
}
