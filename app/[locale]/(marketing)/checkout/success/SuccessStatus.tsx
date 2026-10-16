"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

// D-11: ~15-20s window — 18000ms adopted (RESEARCH.md Open Question #3).
const CONFIRMATION_TIMEOUT_MS = 18000;

export function SuccessStatus({ locale = "en" }: { locale?: string }) {
  const t = useTranslations("CheckoutSuccess");

  // D-09: reactive, websocket-pushed query — re-renders automatically the
  // instant the Phase 2 webhook writes/updates the subscriptions row. No
  // polling / setInterval.
  // Security: no clerkUserId arg — the query derives the caller's identity
  // from Convex auth itself (IDOR fix, 03-REVIEW.md CR-01).
  const { data } = useQuery(convexQuery(api.subscriptions.getSubscription, {}));

  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), CONFIRMATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // D-09/D-10/D-11 precedence: active confirmation wins whenever it arrives
  // (even after timeout); otherwise timeout copy once the window elapses;
  // otherwise the loading state. Any non-"active" status within the window
  // is treated as "still confirming," never as an error (webhook ordering
  // is not guaranteed to deliver the active row first).
  const isActive = data?.status === "active";

  return (
    <div className="mx-auto w-full max-w-md py-16">
      <Card>
        {isActive ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">
                {t("confirmedHeading")}
              </CardTitle>
              <CardDescription>{t("confirmedBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/${locale}/notes`}>{t("goToNotes")}</Link>
              </Button>
            </CardContent>
          </>
        ) : timedOut ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">
                {t("timeoutHeading")}
              </CardTitle>
              <CardDescription>{t("timeoutBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                {t("timeoutAction")}
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Loader2
                  className="size-5 animate-spin text-primary"
                  aria-hidden="true"
                />
                <CardTitle className="text-xl font-semibold">
                  {t("loadingHeading")}
                </CardTitle>
              </div>
              <CardDescription>{t("loadingBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
