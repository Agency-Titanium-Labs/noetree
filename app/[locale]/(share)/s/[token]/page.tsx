import { getTranslations } from "next-intl/server";

import SharedNoteView from "@/components/SharedNoteView";

export async function generateMetadata() {
  const t = await getTranslations("SharedNote");
  return {
    title: t("pageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer" as const,
  };
}

export default async function SharedNotePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params;
  return <SharedNoteView token={token} />;
}
