"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PACKS, PACK_KEYS, type PackKey } from "@/convex/helpers/creditCatalog";
import {
  createCreditPackCheckoutSession,
  type CheckoutActionState,
} from "@/app/[locale]/(app)/settings/actions";

interface CreditPackPickerProps {
  returnTo: "notes" | "settings";
}

const INITIAL_STATE: CheckoutActionState = { error: null };

function PackCard({
  pack,
  returnTo,
  onError,
}: {
  pack: PackKey;
  returnTo: "notes" | "settings";
  onError: (hasError: boolean) => void;
}) {
  const t = useTranslations("AiCredits");
  const [state, formAction, isPending] = useActionState(
    createCreditPackCheckoutSession,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (isPending) onError(false);
    else if (state.error) onError(true);
  }, [isPending, state, onError]);

  const { credits, priceCents } = PACKS[pack];
  const recommended =
    "recommended" in PACKS[pack] && PACKS[pack].recommended === true;
  const price = priceCents / 100;
  const name = t(`packs.${pack}`);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4",
        recommended && "border-2 border-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{name}</span>
        {recommended ? (
          <Badge variant="secondary">{t("bestValue")}</Badge>
        ) : null}
      </div>
      <p className="text-xl font-semibold">{t("packPrice", { price })}</p>
      <p className="text-xs text-muted-foreground">
        {t("packCredits", { count: credits })}
      </p>
      <form action={formAction}>
        <input type="hidden" name="pack" value={pack} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Button
          type="submit"
          variant={recommended ? "default" : "outline"}
          className="w-full min-h-11 md:min-h-9"
          disabled={isPending}
          aria-label={t("buyAria", { name, credits, price })}
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("buyCta")}
        </Button>
      </form>
    </div>
  );
}

export default function CreditPackPicker({ returnTo }: CreditPackPickerProps) {
  const t = useTranslations("AiCredits");
  const [hasError, setHasError] = useState(false);

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label={t("packsGroupAria")}
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {PACK_KEYS.map(pack => (
          <PackCard
            key={pack}
            pack={pack}
            returnTo={returnTo}
            onError={setHasError}
          />
        ))}
      </div>
      {hasError ? (
        <p className="text-sm text-destructive" role="alert">
          {t("checkoutError")}
        </p>
      ) : null}
    </div>
  );
}
