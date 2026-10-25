"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import EditorToolbar from "./editor/EditorToolbar";
import { EditorContent } from "@tiptap/react";
import ConditionChecker from "./helpers/ConditionChecker";
import { AlertCircle, CheckCircle2, Store, UserPlus } from "lucide-react";
import { useEditorContext } from "@/providers/EditorProvider";
import { useTreeContext, type NoteTree } from "@/providers/TreeProvider";
import { usePathname, useRouter } from "@/i18n/routing";
import { Skeleton } from "./ui/skeleton";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";
import ShareDialog from "./ShareDialog";
import ListingFormDialog from "./ListingFormDialog";
import CommentsButton from "./CommentsButton";
import CommentsPanel from "./CommentsPanel";
import HistoryButton from "./HistoryButton";
import HistoryPanel from "./HistoryPanel";
import LinkedNotesBlock from "./LinkedNotesBlock";
import VersionPreviewBanner from "./VersionPreviewBanner";
import CollaboratorsPile from "./CollaboratorsPile";
import dynamic from "next/dynamic";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";

// Loaded on first open: keeps the AI SDK and the Markdown renderer out of the
// initial editor bundle.
const AiChatPanel = dynamic(() => import("./editor/AiChatPanel"), {
  ssr: false,
});
const RelatedNotesPanel = dynamic(() => import("./editor/RelatedNotesPanel"), {
  ssr: false,
});

function findInTree(id: string, note: NoteTree): NoteTree | null {
  if (note._id === id) return note;
  for (const child of note.childNotes ?? []) {
    const found = findInTree(id, child);
    if (found) return found;
  }
  return null;
}

export default function NoteContent() {
  const t = useTranslations("NoteContent");
  const tShare = useTranslations("ShareDialog");
  const { selectedNote, tree, onSelectNote } = useTreeContext();
  const tListing = useTranslations("ListingForm");
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Phase 22: Related notes panel, docked in the same slot as the chat (one
  // at a time). It auto-starts only when opened from the AI menu.
  const [isLinksOpen, setIsLinksOpen] = useState(false);
  // One-shot request set ONLY by the menu entry, bound to the note that was
  // open at that moment. Consumed by the panel on first use, and dropped as
  // soon as another note is selected: switching notes never starts a paid
  // analysis.
  const [linksRequest, setLinksRequest] = useState<{
    noteId: string;
    seq: number;
  } | null>(null);
  // `seq` changes on every menu request so the panel re-syncs its mode even
  // when it is already open (review M3).
  const [chatRequest, setChatRequest] = useState<{
    mode: "chat" | "tree";
    seq: number;
  }>({ mode: "chat", seq: 0 });
  const [isListingOpen, setIsListingOpen] = useState(false);

  const { editor, saveStatus, getCurrentContent, previewVersion, exitPreview } =
    useEditorContext();

  const searchParams = useSearchParams();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const commentsParam = searchParams.get("comments");
  const focusCommentId = searchParams.get("c");
  const routeNoteId = params.id as string | undefined;
  const [isCommentsOpen, setIsCommentsOpen] = useState(
    searchParams.get("comments") === "1",
  );

  // D-15: a bell click for the note already on screen is a same-route push
  // that does not remount NoteContent, so re-open on param changes. Also
  // select the notification's note so the panel targets the right note.
  useEffect(() => {
    if (commentsParam !== "1") return;
    if (
      routeNoteId &&
      tree &&
      selectedNote &&
      selectedNote._id !== routeNoteId
    ) {
      const target = findInTree(routeNoteId, tree);
      if (target) onSelectNote(target, getCurrentContent);
    }
    setIsCommentsOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsParam, focusCommentId, routeNoteId]);

  const selectedId = selectedNote?._id;
  useEffect(() => {
    setLinksRequest(req => (req && req.noteId !== selectedId ? null : req));
  }, [selectedId]);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // Client mirror of D-12; the server is authoritative.
  const canViewHistory = !!selectedNote && selectedNote.role !== "view";

  useEffect(() => {
    if (!canViewHistory) setIsHistoryOpen(false);
  }, [canViewHistory]);

  const commentsTarget = useMemo(
    () =>
      selectedNote ? { kind: "note" as const, noteId: selectedNote._id } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedNote?._id],
  );

  const handleCommentsOpenChange = useCallback(
    (open: boolean) => {
      setIsCommentsOpen(open);
      if (!open && searchParams.get("comments")) router.replace(pathname);
    },
    [searchParams, router, pathname],
  );

  const openLinkedNote = useCallback(
    (id: string) => {
      if (!tree) return;
      const target = findInTree(id, tree);
      if (target) onSelectNote(target, getCurrentContent);
    },
    [tree, onSelectNote, getCurrentContent],
  );

  const content = (
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
              {commentsTarget && (
                <CommentsButton
                  target={commentsTarget}
                  isOpen={isCommentsOpen}
                  onClick={() => setIsCommentsOpen(o => !o)}
                />
              )}
              {canViewHistory && (
                <HistoryButton
                  isOpen={isHistoryOpen}
                  onClick={() => setIsHistoryOpen(o => !o)}
                />
              )}
              {selectedNote?.role === "owner" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsListingOpen(true)}
                  title={tListing("triggerTooltip")}
                >
                  <Store />
                  {tListing("triggerLabel")}
                </Button>
              )}
              <CollaboratorsPile noteId={selectedNote?._id} />
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
          <EditorToolbar
            onOpenChat={mode => {
              setChatRequest(prev => ({
                mode: mode ?? "chat",
                seq: prev.seq + 1,
              }));
              setIsLinksOpen(false);
              setLinksRequest(null);
              setIsChatOpen(true);
            }}
            onOpenLinks={() => {
              // The chat is NOT closed: it stays mounted (hidden) so an
              // unapplied, already charged proposal survives (review M3).
              if (selectedNote) {
                setLinksRequest(prev => ({
                  noteId: selectedNote._id,
                  seq: (prev?.seq ?? 0) + 1,
                }));
              }
              setIsLinksOpen(true);
            }}
          />
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
            <>
              <VersionPreviewBanner />
              <div
                onKeyDown={event => {
                  if (event.key === "Escape" && previewVersion) exitPreview();
                }}
                className="flex flex-1"
              >
                <EditorContent editor={editor} />
              </div>
              {selectedNote?.role === "owner" && (
                <LinkedNotesBlock
                  noteId={selectedNote._id}
                  onOpenNote={openLinkedNote}
                />
              )}
            </>
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
      {commentsTarget && (
        <CommentsPanel
          target={commentsTarget}
          open={isCommentsOpen}
          onOpenChange={handleCommentsOpenChange}
          focusCommentId={focusCommentId}
        />
      )}
      {selectedNote && canViewHistory && (
        <HistoryPanel
          noteId={selectedNote._id}
          open={isHistoryOpen}
          onOpenChange={setIsHistoryOpen}
        />
      )}
      {selectedNote && isListingOpen && (
        <ListingFormDialog
          noteId={selectedNote._id}
          noteTitle={selectedNote.title}
          open={isListingOpen}
          onOpenChange={setIsListingOpen}
        />
      )}
    </div>
  );

  // The AI chat docks UNDER the note (19-CONTEXT D-01): the note stays
  // visible and editable, and the split is resizable.
  //
  // The group is ALWAYS rendered with the same structure; only the chat
  // panel (and its handle) is conditional. Toggling the chat therefore never
  // changes the element type or position of the note subtree, so React keeps
  // the editor mounted and its state (selection, undo history, unsaved text)
  // survives (review M1).
  const chatOpen = isChatOpen && !!selectedNote;
  const linksOpen = isLinksOpen && !!selectedNote;
  const dockOpen = chatOpen || linksOpen;
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-[calc(100dvh-7rem)] min-h-[480px]"
    >
      <ResizablePanel
        id="note"
        defaultSize={dockOpen ? "60%" : "100%"}
        minSize="25%"
      >
        <div className="h-full overflow-auto pr-1">{content}</div>
      </ResizablePanel>
      {dockOpen && selectedNote ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="dock" defaultSize="40%" minSize="25%">
            {linksOpen ? (
              <div className="h-full">
                {/* keyed by note, like the chat: results never re-point */}
                <RelatedNotesPanel
                  key={selectedNote._id}
                  noteId={selectedNote._id}
                  autoStart={linksRequest?.noteId === selectedNote._id}
                  onAutoStartConsumed={() => setLinksRequest(null)}
                  onOpenNote={openLinkedNote}
                  onClose={() => {
                    setLinksRequest(null);
                    setIsLinksOpen(false);
                  }}
                />
              </div>
            ) : null}
            {chatOpen ? (
              // Stays mounted while the links panel is shown, only hidden.
              <div hidden={linksOpen} className="h-full">
                {/* keyed by note: a conversation never re-points to another
                    note when the selection changes (review M2) */}
                <AiChatPanel
                  key={selectedNote._id}
                  noteId={selectedNote._id}
                  initialMode={chatRequest.mode}
                  requestedMode={chatRequest}
                  onClose={() => setIsChatOpen(false)}
                />
              </div>
            ) : null}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}
