import { getTranslations } from "next-intl/server";

import PublicNoteView from "@/components/PublicNoteView";

export async function generateMetadata() {
  const t = await getTranslations("SharedNote");
  return {
    title: t("pageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer" as const,
  };
}

export default async function PublicNotePage({
  params,
}: {
  params: Promise<{ locale: string; noteId: string }>;
}) {
  const { noteId } = await params;
  return <PublicNoteView noteId={noteId} />;
}
