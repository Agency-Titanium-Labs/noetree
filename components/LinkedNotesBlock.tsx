"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface LinkedNotesBlockProps {
  noteId: Id<"notes">;
  onOpenNote: (noteId: Id<"notes">) => void;
}

/**
 * "Linked notes" (22-CONTEXT D-01): the accepted links of this note, from both
 * directions (a link is stored once and listed on both notes). Titles are
 * rendered as text. Renders nothing when the note has no link, so notes that
 * never used the feature look unchanged.
 */
export default function LinkedNotesBlock({
  noteId,
  onOpenNote,
}: LinkedNotesBlockProps) {
  const t = useTranslations("LinkedNotes");
  const links = useQuery(api.links.listLinkedNotes, { noteId });
  const removeLink = useMutation(api.links.removeLink);

  if (!links || links.length === 0) return null;

  return (
    <section aria-label={t("title")} className="mt-2 border-t pt-2 text-sm">
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <Link2 className="h-4 w-4" />
        {t("title")}
      </h3>
      <ul aria-label={t("listAria")} className="space-y-1">
        {links.map(l => (
          <li key={l.linkId} className="flex items-center gap-2">
            <button
              type="button"
              className="text-left underline-offset-2 hover:underline"
              aria-label={t("open", { title: l.title || t("untitled") })}
              onClick={() => onOpenNote(l.noteId)}
            >
              {l.title || t("untitled")}
            </button>
            <button
              type="button"
              className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={t("removeAria", { title: l.title || t("untitled") })}
              title={t("remove")}
              onClick={() => {
                removeLink({ linkId: l.linkId }).catch(() =>
                  toast.error(t("removeError")),
                );
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
