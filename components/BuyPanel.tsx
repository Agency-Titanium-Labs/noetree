"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Store } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import BuyButton from "@/components/BuyButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { Link, usePathname, useRouter } from "@/i18n/routing";

type Override = "own" | "owned" | "unavailable" | "signedOut" | null;

const SLOW_MS = 60_000;

export default function BuyPanel({
  listingId,
  priceCents,
}: {
  listingId: string;
  priceCents: number;
}) {
  const t = useTranslations("Marketplace");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useUser();
  const [override, setOverride] = useState<Override>(null);
  const [slow, setSlow] = useState(false);

  const { data, isPending } = useQuery(
    convexQuery(api.purchases.getMyListingState, { listingId }),
  );

  const purchaseParam = searchParams?.get("purchase") === "success";
  const serverState = data?.state;
  const delivery = data?.delivery;
  const openNoteId = data?.openNoteId;
  const effective: string | null =
    override === "own"
      ? "own"
      : override === "owned"
        ? "owned"
        : (serverState ?? null);
  const isOwned = effective === "owned";
  const showProcessing =
    purchaseParam && !isOwned && effective !== "own" && !!isSignedIn;

  // Owned + stale ?purchase=success: silently drop the param (D-03).
  useEffect(() => {
    if (purchaseParam && isOwned) {
      router.replace(pathname);
    }
  }, [purchaseParam, isOwned, router, pathname]);

  // Single timer for the slow-path copy; the reactive query does the flip.
  useEffect(() => {
    if (!showProcessing) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [showProcessing]);

  const priceLabel = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);

  const handleTerminal = (code: string) => {
    if (code === "UNAUTHENTICATED") setOverride("signedOut");
    else if (code === "PURCHASE_OWN_LISTING") setOverride("own");
    else if (code === "PURCHASE_ALREADY_OWNED") setOverride("owned");
    else setOverride("unavailable");
  };

  const salesFinal = (
    <p className="text-sm text-muted-foreground">{t("salesFinal")}</p>
  );

  // 1) Loading
  if (!isLoaded || (isSignedIn && isPending)) {
    return <Skeleton className="h-11 w-full" />;
  }

  // 2) Signed out
  if (!isSignedIn || override === "signedOut" || serverState === "anonymous") {
    const redirectUrl =
      typeof window !== "undefined" ? window.location.pathname : undefined;
    return (
      <div className="flex flex-col gap-2">
        <SignInButton mode="modal" forceRedirectUrl={redirectUrl}>
          <Button className="h-11 w-full font-semibold">
            {t("signInToBuy")}
          </Button>
        </SignInButton>
        {salesFinal}
      </div>
    );
  }

  // 8) Unavailable
  if (override === "unavailable" || data === null) {
    return null;
  }

  // 3) Own listing
  if (effective === "own") {
    return (
      <Alert>
        <Store className="size-4" aria-hidden />
        <AlertTitle>{t("ownListingTitle")}</AlertTitle>
        <AlertDescription>
          <p>{t("ownListingBody")}</p>
          <Button asChild variant="outline" className="mt-2 w-full sm:w-auto">
            <Link href="/listings">{t("ownListingLink")}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // 4) Owned
  if (isOwned) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Badge variant="secondary" className="gap-1">
            <span
              className="size-2 rounded-full bg-primary"
              aria-hidden="true"
            />
            <Check className="size-3" aria-hidden />
            {t("ownedBadge")}
          </Badge>
        </div>
        <p className="text-sm">{t("ownedBody")}</p>
        {delivery === "failed" ? (
          <Alert role="status">
            <AlertTitle>{t("deliveryFailedTitle")}</AlertTitle>
            <AlertDescription>{t("deliveryFailedBody")}</AlertDescription>
          </Alert>
        ) : (
          <>
            {delivery === "pending" && (
              <p className="text-sm text-muted-foreground">
                {t("deliveryPending")}
              </p>
            )}
            {openNoteId && (
              <Button asChild className="w-full sm:w-auto">
                <Link href={`/notes/${openNoteId}`}>{t("openNote")}</Link>
              </Button>
            )}
          </>
        )}
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/">{t("ownedCta")}</Link>
        </Button>
      </div>
    );
  }

  // 5) Processing
  if (showProcessing) {
    return (
      <Alert className="bg-muted" role="status" aria-live="polite">
        <Loader2
          className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden
        />
        <AlertTitle>{t("processingTitle")}</AlertTitle>
        <AlertDescription>
          <p>{t("processingBody")}</p>
          {slow && (
            <p className="text-sm text-muted-foreground">
              {t("processingSlow")}
            </p>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // 6/7) Pending or buyable
  return (
    <div className="flex flex-col gap-2">
      <BuyButton
        listingId={listingId}
        priceLabel={priceLabel}
        onTerminal={handleTerminal}
      />
      {salesFinal}
    </div>
  );
}
