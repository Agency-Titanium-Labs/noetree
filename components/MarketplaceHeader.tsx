"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

export default function MarketplaceHeader() {
  const t = useTranslations("Marketplace");
  const { isLoaded, isSignedIn } = useUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <Link href="/" className="font-semibold">
            NoeTree
          </Link>
          <span className="text-sm text-muted-foreground">
            {t("headerLabel")}
          </span>
        </div>
        <div>
          {isLoaded &&
            (isSignedIn ? (
              <Button asChild>
                <Link href="/notes">{t("openApp")}</Link>
              </Button>
            ) : (
              <SignInButton mode="modal">
                <Button variant="outline">{t("signIn")}</Button>
              </SignInButton>
            ))}
        </div>
      </div>
    </header>
  );
}
