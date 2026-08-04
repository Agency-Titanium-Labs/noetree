"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { createConnectOnboardingLink } from "@/app/[locale]/(app)/settings/connect-actions";

export default function SettingsSellerCard() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const { isSignedIn } = useUser();

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);

  // Pattern 3 / Pitfall 5: the "skip" sentinel string, never a boolean
  // enabled-flag option.
  // Security: no clerkUserId arg — the query derives the caller's identity
  // from Convex auth itself (IDOR fix, 03-REVIEW.md CR-01).
  //
  // D-08 / 07-RESEARCH.md Pitfall 1: this card renders the webhook-synced
  // `status` field only. It never reads the URL's query string, never
  // derives an optimistic "verifying" state from the Stripe return_url, and
  // never inspects the raw Stripe capability booleans directly on the
  // client — those live server-side only (isSellerActive, 07-01) and are
  // intentionally not surfaced here.
  const { data: connectAccount, isPending: isConnectPending } = useQuery(
    convexQuery(
      api.connectAccounts.getMyConnectStatus,
      isSignedIn ? {} : "skip",
    ),
  );

  async function handleOnboard() {
    setError(false);
    setIsPending(true);
    try {
      await createConnectOnboardingLink(locale);
      // No `finally` resetting isPending: on success this action redirects
      // and never resolves normally — the browser navigates away before any
      // further state update would matter.
    } catch (err) {
      console.error("handleOnboard: seller onboarding action failed", err);
      setError(true);
      setIsPending(false);
    }
  }

  const showSkeleton = isSignedIn && isConnectPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          {t("sellerCardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showSkeleton ? (
          <Skeleton className="h-6 w-40" />
        ) : (
          <>
            {!connectAccount && (
              <div className="space-y-2">
                <p className="text-base">{t("sellerNotStartedBody")}</p>
                <Button onClick={handleOnboard} disabled={isPending}>
                  {t("becomeSellerCta")}
                </Button>
              </div>
            )}

            {connectAccount?.status === "pending" && (
              <div className="space-y-2">
                <Badge variant="secondary">{t("sellerStatusPending")}</Badge>
                <p className="text-base">{t("sellerPendingBody")}</p>
                <Button onClick={handleOnboard} disabled={isPending}>
                  {t("resumeOnboardingCta")}
                </Button>
              </div>
            )}

            {connectAccount?.status === "active" && (
              <div className="space-y-2">
                <Badge variant="default">{t("sellerStatusActive")}</Badge>
                <p className="text-base">{t("sellerActiveBody")}</p>
              </div>
            )}

            {connectAccount?.status === "restricted" && (
              <div className="space-y-2">
                <Badge variant="destructive">
                  {t("sellerStatusRestricted")}
                </Badge>
                <p className="text-base">{t("sellerRestrictedBody")}</p>
                <Button onClick={handleOnboard} disabled={isPending}>
                  {t("updateDetailsCta")}
                </Button>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">
                {t("sellerActionError")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
