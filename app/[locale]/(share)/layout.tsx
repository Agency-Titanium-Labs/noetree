import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

export default async function ShareLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const t = await getTranslations("SharedNote");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex-1">{children}</div>
      <footer className="mt-16 bg-muted">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="text-sm">{t("footerMade")}</span>
          <Button asChild>
            <Link href="/">{t("footerCta")}</Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}
