"use client";

import { useState } from "react";
import EditorToolbar from "./editor/EditorToolbar";
import { EditorContent } from "@tiptap/react";
import ConditionChecker from "./helpers/ConditionChecker";
import { AlertCircle, CheckCircle2, UserPlus } from "lucide-react";
import { useEditorContext } from "@/providers/EditorProvider";
import { useTreeContext } from "@/providers/TreeProvider";
import { Skeleton } from "./ui/skeleton";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";
import ShareDialog from "./ShareDialog";

export default function NoteContent() {
  const t = useTranslations("NoteContent");
  const tShare = useTranslations("ShareDialog");
  const { selectedNote } = useTreeContext();
  const [isShareOpen, setIsShareOpen] = useState(false);

  const { editor, saveStatus } = useEditorContext();

  return (
    <div className="min-h-full flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <ConditionChecker condition={!selectedNote}>
          <Skeleton className="w-56 h-8" />
        </ConditionChecker>
        <ConditionChecker condition={!!selectedNote}>
          <>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold">{selectedNote?.title}</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsShareOpen(true)}
                title={tShare("buttonTooltip")}
              >
                <UserPlus />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <ConditionChecker condition={saveStatus === "error"}>
                <div className="flex items-center text-destructive gap-1">
                  <AlertCircle />
                  <span className="text-sm">{t("status.failed")}</span>
                </div>
              </ConditionChecker>
              <ConditionChecker condition={saveStatus === "success"}>
                <div className="flex items-center text-green-600 gap-1">
                  <CheckCircle2 />
                  <span className="text-sm">{t("status.saved")}</span>
                </div>
              </ConditionChecker>
              <ConditionChecker condition={saveStatus === "saving"}>
                <span className="text-sm text-gray-500 animate-pulse">
                  {t("status.saving")}
                </span>
              </ConditionChecker>
              <ConditionChecker
                condition={saveStatus === "unsaved" && !!selectedNote}
              >
                <span className="text-sm text-amber-500">
                  {t("status.unsaved")}
                </span>
              </ConditionChecker>
            </div>
          </>
        </ConditionChecker>
      </div>
      <div className="grow flex flex-col gap-4">
        <div className="flex flex-col gap-2 grow">
          <EditorToolbar />
          <ConditionChecker condition={!selectedNote}>
            <div className="flex-1 p-4 flex flex-col gap-4 border rounded-md">
              <Skeleton className="w-56 h-8 mt-4" />
              <div className="flex flex-col gap-2">
                <Skeleton className="w-64 h-4" />
                <Skeleton className="w-48 h-4" />
              </div>
            </div>
          </ConditionChecker>
          <ConditionChecker condition={!!selectedNote}>
            <EditorContent editor={editor} />
          </ConditionChecker>
        </div>
      </div>
      {selectedNote && (
        <ShareDialog
          noteId={selectedNote._id}
          open={isShareOpen}
          onOpenChange={setIsShareOpen}
        />
      )}
    </div>
  );
}
