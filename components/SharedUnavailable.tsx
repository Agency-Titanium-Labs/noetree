"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

export default function SharedUnavailable({
  message,
}: Readonly<{ message?: string }>) {
  const t = useTranslations("SharedNote");

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-12 text-center sm:px-6">
      <h1 className="text-xl font-semibold">{t("invalidTitle")}</h1>
      <p className="text-base text-muted-foreground">
        {message ?? t("invalidBody")}
      </p>
      <Button asChild variant="outline">
        <Link href="/">{t("invalidCta")}</Link>
      </Button>
    </div>
  );
}
