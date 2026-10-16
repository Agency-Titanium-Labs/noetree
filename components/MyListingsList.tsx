"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "@/convex/_generated/api";
import MyListingRow from "@/components/MyListingRow";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyListingsList() {
  const t = useTranslations("MyListings");
  const { isSignedIn } = useUser();
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const { data } = useQuery(
    convexQuery(api.listings.listMine, isSignedIn ? {} : "skip"),
  );

  function handleStatus(message: string, isError = false) {
    setStatus({ message, isError });
  }

  return (
    <div className="flex flex-col gap-4">
      <p
        aria-live="polite"
        role="status"
        className={status?.isError ? "text-sm text-destructive" : "text-sm"}
      >
        {status?.message}
      </p>
      {data === undefined ? (
        <>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
          <p className="text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.map(listing => (
            <MyListingRow
              key={listing._id}
              listing={listing}
              onStatus={handleStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}
