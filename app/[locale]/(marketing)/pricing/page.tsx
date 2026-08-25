"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createCheckoutSession } from "./actions";

export default function PricingPage() {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const { isSignedIn } = useUser();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");

  // Pattern 3 / Pitfall 5: "skip" sentinel, never `enabled: false`.
  // Security: no clerkUserId arg — the query derives the caller's identity
  // from Convex auth itself (IDOR fix, 03-REVIEW.md CR-01).
  const { data: tier } = useQuery(
    convexQuery(
      api.subscriptions.getSubscriptionTier,
      isSignedIn ? {} : "skip",
    ),
  );

  const isPremium = tier === "premium";

  async function handleUpgrade() {
    setError(false);
    setIsPending(true);
    try {
      await createCheckoutSession(locale, interval);
    } catch (err) {
      // D-15/D-02: sign-in and Stripe redirects throw internally (Next's
      // redirect-throw); only a genuine Checkout Session creation failure
      // reaches this catch (see actions.ts's narrow try/catch).
      // Gap closure (03-06): log the real thrown error (e.g.
      // subscriptionLookupFailed vs checkoutSessionCreationFailed) so it is
      // readable in the browser console instead of only the static red text.
      console.error("Checkout upgrade failed", err);
      setError(true);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-12 py-16">
      <div className="max-w-3xl space-y-4 text-center">
        <h1 className="text-3xl font-semibold">{t("heading")}</h1>
        <p className="text-muted-foreground text-base">{t("subheading")}</p>
      </div>

      <div className="grid w-full max-w-3xl gap-8 sm:grid-cols-2">
        {/* Free plan card — no clickable CTA (D-13) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("freeName")}</CardTitle>
            {!isPremium && isSignedIn && (
              <Badge variant="secondary">{t("currentPlanBadge")}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-base font-semibold">{t("freePrice")}</p>
            <p className="text-sm text-muted-foreground">{t("freeDetail")}</p>
          </CardContent>
        </Card>

        {/* Premium plan card — accent border marks it as the recommended plan */}
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-xl">{t("premiumName")}</CardTitle>
            {isPremium && (
              <Badge variant="default">{t("currentPlanBadge")}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleGroup
              type="single"
              variant="outline"
              size="lg"
              value={interval}
              onValueChange={value => {
                if (value) setInterval(value as "monthly" | "annual");
              }}
            >
              <ToggleGroupItem value="monthly" className="font-normal">
                {t("intervalMonthly")}
              </ToggleGroupItem>
              <ToggleGroupItem value="annual" className="font-normal">
                {t("intervalAnnual")}
              </ToggleGroupItem>
            </ToggleGroup>
            <Badge variant="secondary">{t("annualSaveBadge")}</Badge>
            <p className="text-base font-semibold">
              {interval === "annual"
                ? t("premiumPriceAnnual")
                : t("premiumPriceMonthly")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("premiumDetail")}
            </p>
          </CardContent>
          {!isPremium && (
            <CardFooter className="flex-col items-stretch gap-2">
              <Button
                className="h-11"
                onClick={handleUpgrade}
                disabled={isPending}
              >
                {t("upgradeCta")}
              </Button>
              {error && (
                <p className="text-sm text-destructive">{t("checkoutError")}</p>
              )}
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
