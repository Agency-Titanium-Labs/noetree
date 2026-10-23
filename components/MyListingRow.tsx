"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConvexMutation } from "@convex-dev/react-query";
import { ConvexError } from "convex/values";

import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { Link } from "@/i18n/routing";
import ListingFormDialog from "@/components/ListingFormDialog";
import PriceLabel from "@/components/PriceLabel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface MyListingRowProps {
  listing: Doc<"listings"> & { sourceNoteTitle: string | null };
  onStatus: (message: string, isError?: boolean) => void;
}

function errorCode(err: unknown): string | null {
  if (!(err instanceof ConvexError)) return null;
  const data: unknown = err.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

export default function MyListingRow({ listing, onStatus }: MyListingRowProps) {
  const t = useTranslations("MyListings");
  const tForm = useTranslations("ListingForm");
  const locale = useLocale();

  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const setStatus = useConvexMutation(api.listings.setListingStatus);
  const sourceMissing = listing.sourceNoteTitle === null;

  async function changeStatus(
    status: "published" | "unpublished",
    successMessage: string,
  ) {
    setIsPending(true);
    try {
      await setStatus({ listingId: listing._id, status });
      onStatus(successMessage);
    } catch (err) {
      switch (errorCode(err)) {
        case "CONNECT_ONBOARDING_REQUIRED":
          onStatus(t("errorSellerNotReady"), true);
          break;
        case "LISTING_NOTE_MISSING":
          onStatus(t("errorNoteMissing"), true);
          break;
        case "LISTING_SUBTREE_TOO_LARGE":
          onStatus(tForm("errorScopeCap"), true);
          break;
        case "LISTING_CONTAINS_FOREIGN_NOTES":
          onStatus(tForm("errorForeignNotes"), true);
          break;
        default:
          onStatus(t("errorGeneric"), true);
      }
    } finally {
      setIsPending(false);
    }
  }

  const isPublished = listing.status === "published";

  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-xl font-semibold">{listing.title}</h2>
      <p className="text-sm text-muted-foreground">
        {listing.sourceNoteTitle !== null
          ? t("sourceNote", { title: listing.sourceNoteTitle })
          : t("sourceDeleted")}
      </p>
      <div>
        {isPublished ? (
          <Badge variant="secondary" className="gap-1.5">
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            {t("statusPublished")}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t("statusUnpublished")}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <PriceLabel cents={listing.priceCents} />
        <span>
          {listing.accessMode === "copy"
            ? t("accessCopy")
            : t("accessReadonly")}
        </span>
        <span>{t("noteCount", { count: listing.noteCount })}</span>
        <span>
          {t("createdOn", {
            date: new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
            }).format(listing._creationTime),
          })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={sourceMissing || isPending}
          onClick={() => setEditOpen(true)}
        >
          {t("edit")}
        </Button>
        {isPublished ? (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("unpublish")}
          </Button>
        ) : (
          <Button
            disabled={sourceMissing || isPending}
            onClick={() => changeStatus("published", t("successRepublished"))}
          >
            {t("republish")}
          </Button>
        )}
        {isPublished && (
          <Button asChild variant="ghost">
            <Link href={`/marketplace/${listing._id}`}>{t("view")}</Link>
          </Button>
        )}
      </div>

      {editOpen && (
        <ListingFormDialog
          noteId={listing.noteId}
          noteTitle={listing.sourceNoteTitle ?? listing.title}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("unpublishConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("unpublishConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() =>
                changeStatus("unpublished", t("successUnpublished"))
              }
            >
              {t("unpublishConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
