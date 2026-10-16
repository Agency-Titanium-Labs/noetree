"use client";

import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";

export default function Dashboard() {
  const t = useTranslations("Dashboard");

  useHeaderConfig({
    title: t("title"),
  });

  return (
    <div className="flex flex-col justify-center items-center gap-8 p-6 min-h-[50vh]">
      <div className="max-w-md text-center space-y-6 mt-12">
        <p className="text-muted-foreground text-lg">{t("welcomeText")}</p>
        <Link
          href="/notes"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {t("notesLink")}
        </Link>
      </div>
    </div>
  );
}
