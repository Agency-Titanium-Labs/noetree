"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Loader2, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Link } from "@/i18n/routing";
import {
  centsToPriceInput,
  normalizeTagInput,
  parsePriceToCents,
} from "@/lib/listingForm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SellerPriceBreakdown from "@/components/SellerPriceBreakdown";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GUARD_NAMESPACE, guardErrorMessageKey } from "@/lib/purchaseShareUi";

interface ListingFormDialogProps {
  noteId: Id<"notes">;
  noteTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_PRICE_CENTS = 100;
const MAX_PRICE_CENTS = 50000;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 24;

type FormValues = {
  title: string;
  description: string;
  price: string;
  scope: "note" | "subtree";
  accessMode: "copy" | "readonly";
  tags: string[];
  attested: boolean;
};

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

export default function ListingFormDialog({
  noteId,
  noteTitle,
  open,
  onOpenChange,
}: ListingFormDialogProps) {
  const t = useTranslations("ListingForm");
  const tGuards = useTranslations(GUARD_NAMESPACE);

  const existingQuery = useQuery(
    convexQuery(api.listings.getMineByNote, open ? { noteId } : "skip"),
  );
  const existing = existingQuery.data ?? null;
  const mode = existing ? "edit" : "create";

  const connectQuery = useQuery(
    convexQuery(api.connectAccounts.getMyConnectStatus, open ? {} : "skip"),
  );
  const connectLoaded = connectQuery.data !== undefined;
  const sellerReady =
    !!connectQuery.data?.chargesEnabled && !!connectQuery.data?.payoutsEnabled;

  const createListing = useConvexMutation(api.listings.createListing);
  const updateListing = useConvexMutation(api.listings.updateListing);

  const schema = React.useMemo(
    () =>
      z.object({
        title: z
          .string()
          .trim()
          .min(1, t("errorTitle"))
          .max(100, t("errorTitle")),
        description: z
          .string()
          .trim()
          .min(1, t("errorDescription"))
          .max(1000, t("errorDescription")),
        price: z.string().refine(v => {
          const cents = parsePriceToCents(v);
          return (
            cents !== null &&
            cents >= MIN_PRICE_CENTS &&
            cents <= MAX_PRICE_CENTS
          );
        }, t("errorPrice")),
        scope: z.enum(["note", "subtree"]),
        accessMode: z.enum(["copy", "readonly"]),
        tags: z.array(z.string()).max(MAX_TAGS, t("errorTagsMax")),
        attested: z.boolean().refine(v => v === true, t("errorAttestation")),
      }),
    [t],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: noteTitle,
      description: "",
      price: "",
      scope: "note",
      accessMode: "copy",
      tags: [],
      attested: false,
    },
  });

  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sellerBlocked, setSellerBlocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successListingId, setSuccessListingId] =
    useState<Id<"listings"> | null>(null);
  const [successPublished, setSuccessPublished] = useState(true);
  const [successMode, setSuccessMode] = useState<"create" | "edit">("create");

  const existingId = existing?._id;
  useEffect(() => {
    if (!open) return;
    if (existing) {
      reset({
        title: existing.title,
        description: existing.description,
        price: centsToPriceInput(existing.priceCents),
        scope: existing.scope,
        accessMode: existing.accessMode,
        tags: existing.tags,
        attested: false,
      });
    } else if (!existingQuery.isLoading) {
      reset({
        title: noteTitle,
        description: "",
        price: "",
        scope: "note",
        accessMode: "copy",
        tags: [],
        attested: false,
      });
    }
    setTagInput("");
    setTagError(null);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingId, existingQuery.isLoading, noteTitle, reset]);

  const scope = watch("scope");
  const tags = watch("tags");
  const description = watch("description");
  const priceInput = watch("price");
  const previewPriceCents = parsePriceToCents(priceInput ?? "");

  const previewQuery = useQuery(
    convexQuery(
      api.listings.previewSubtreeCount,
      open && scope === "subtree" ? { noteId } : "skip",
    ),
  );
  const preview = previewQuery.data;
  const scopeBlocked =
    scope === "subtree" &&
    (preview?.status === "over_cap" || preview?.status === "foreign_notes");

  const showSellerBanner = sellerBlocked || (connectLoaded && !sellerReady);

  const addTag = () => {
    const v = normalizeTagInput(tagInput);
    if (!v) return;
    if (tags.includes(v)) {
      setTagInput("");
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setTagError(t("errorTagsMax"));
      return;
    }
    if (v.length > MAX_TAG_LENGTH) {
      setTagError(t("errorTagLength"));
      return;
    }
    setTagError(null);
    setValue("tags", [...tags, v], { shouldValidate: true });
    setTagInput("");
  };

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    setIsSubmitting(true);
    const priceCents = parsePriceToCents(values.price)!;
    const payload = {
      title: values.title.trim(),
      description: values.description.trim(),
      priceCents,
      scope: values.scope,
      accessMode: values.accessMode,
      tags: values.tags,
      attested: values.attested,
    };
    try {
      let id: Id<"listings">;
      if (existing) {
        await updateListing({ listingId: existing._id, ...payload });
        id = existing._id;
      } else {
        id = await createListing({ noteId, ...payload });
      }
      setSuccessMode(existing ? "edit" : "create");
      setSuccessPublished(existing ? existing.status === "published" : true);
      setSuccessListingId(id);
    } catch (err) {
      switch (errorCode(err)) {
        case "CONNECT_ONBOARDING_REQUIRED":
          setSellerBlocked(true);
          break;
        case "LISTING_SUBTREE_TOO_LARGE":
          setError("scope", { message: t("errorScopeCap") });
          break;
        case "LISTING_CONTAINS_FOREIGN_NOTES":
          setError("scope", { message: t("errorForeignNotes") });
          break;
        case "LISTING_INVALID_PRICE":
          setError("price", { message: t("errorPrice") });
          break;
        case "LISTING_ATTESTATION_REQUIRED":
          setError("attested", { message: t("errorAttestation") });
          break;
        case "LISTING_INVALID_TAGS":
          setError("tags", { message: t("errorTagsMax") });
          break;
        case "LISTING_ALREADY_EXISTS":
          setFormError(t("errorAlreadyListed"));
          break;
        case "LISTING_PURCHASED_CONTENT":
          setFormError(
            tGuards(guardErrorMessageKey("LISTING_PURCHASED_CONTENT")!),
          );
          break;
        case "LISTING_NOTE_MISSING":
          setFormError(t("errorNoteMissing"));
          break;
        case "LISTING_NOT_OWNER":
          setFormError(t("errorNotOwner"));
          break;
        default:
          setFormError(t("errorGeneric"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setSuccessListingId(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(mode === "edit" ? "titleEdit" : "titleCreate")}
          </DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        {successListingId ? (
          <div role="status" className="flex flex-col gap-4">
            <p className="text-sm font-medium text-green-600">
              {t(
                successMode === "edit" ? "successUpdated" : "successPublished",
              )}
            </p>
            <div className="flex items-center gap-3">
              {successPublished && (
                <Link
                  href={`/marketplace/${successListingId}`}
                  className="text-sm font-medium underline underline-offset-4"
                >
                  {t("viewListing")}
                </Link>
              )}
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("close")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            {mode === "edit" && (
              <p className="text-sm text-muted-foreground">
                {t("sourceNoteLabel")}: {noteTitle}
              </p>
            )}
            {existing?.status === "unpublished" && (
              <p className="text-sm text-muted-foreground">
                {t("unpublishedNotice")}
              </p>
            )}

            {showSellerBanner && (
              <div className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span>{t("errorSellerNotReady")}</span>
                  <Link
                    href="/settings"
                    className="font-medium underline underline-offset-4"
                  >
                    {t("sellerNotReadyLink")}
                  </Link>
                </div>
              </div>
            )}

            <Field data-invalid={errors.title ? "true" : undefined}>
              <FieldLabel htmlFor="listing-title">{t("fieldTitle")}</FieldLabel>
              <Input
                id="listing-title"
                maxLength={100}
                aria-invalid={!!errors.title}
                {...register("title")}
              />
              {errors.title && <FieldError>{errors.title.message}</FieldError>}
            </Field>

            <Field data-invalid={errors.description ? "true" : undefined}>
              <FieldLabel htmlFor="listing-description">
                {t("fieldDescription")}
              </FieldLabel>
              <Textarea
                id="listing-description"
                rows={4}
                maxLength={1000}
                aria-invalid={!!errors.description}
                {...register("description")}
              />
              <span className="text-xs text-muted-foreground">
                {t("descriptionCounter", { count: description.length })}
              </span>
              {errors.description && (
                <FieldError>{errors.description.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={errors.price ? "true" : undefined}>
              <FieldLabel htmlFor="listing-price">{t("fieldPrice")}</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  €
                </span>
                <Input
                  id="listing-price"
                  inputMode="decimal"
                  className="pl-7"
                  aria-invalid={!!errors.price}
                  {...register("price")}
                />
              </div>
              {errors.price && <FieldError>{errors.price.message}</FieldError>}
              {!errors.price &&
                previewPriceCents !== null &&
                previewPriceCents >= MIN_PRICE_CENTS &&
                previewPriceCents <= MAX_PRICE_CENTS && (
                  <SellerPriceBreakdown priceCents={previewPriceCents} />
                )}
            </Field>

            <Field data-invalid={errors.scope ? "true" : undefined}>
              <FieldLabel>{t("fieldScope")}</FieldLabel>
              <Controller
                control={control}
                name="scope"
                render={({ field }) => (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    aria-label={t("fieldScope")}
                    value={field.value}
                    onValueChange={v => {
                      if (v) field.onChange(v);
                    }}
                  >
                    <ToggleGroupItem value="note">
                      {t("scopeNote")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="subtree">
                      {t("scopeSubtree")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
              />
              {scope === "subtree" && (
                <>
                  {previewQuery.isLoading || preview === undefined ? (
                    <p className="text-sm text-muted-foreground">
                      {t("scopeCountLoading")}
                    </p>
                  ) : preview?.status === "ok" ? (
                    <p className="text-sm">
                      {t("scopeCount", { count: preview.count })}
                    </p>
                  ) : preview?.status === "over_cap" ? (
                    <FieldError>{t("errorScopeCap")}</FieldError>
                  ) : preview?.status === "foreign_notes" ? (
                    <FieldError>{t("errorForeignNotes")}</FieldError>
                  ) : null}
                </>
              )}
              {errors.scope && <FieldError>{errors.scope.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel>{t("fieldAccess")}</FieldLabel>
              <Controller
                control={control}
                name="accessMode"
                render={({ field }) => (
                  <>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      aria-label={t("fieldAccess")}
                      value={field.value}
                      onValueChange={v => {
                        if (v) field.onChange(v);
                      }}
                    >
                      <ToggleGroupItem value="copy">
                        {t("accessCopy")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="readonly">
                        {t("accessReadonly")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <p className="text-sm text-muted-foreground">
                      {field.value === "copy"
                        ? t("accessCopyHelper")
                        : t("accessReadonlyHelper")}
                    </p>
                  </>
                )}
              />
            </Field>

            <Field data-invalid={errors.tags || tagError ? "true" : undefined}>
              <FieldLabel htmlFor="listing-tags">{t("fieldTags")}</FieldLabel>
              <Input
                id="listing-tags"
                placeholder={t("tagsPlaceholder")}
                maxLength={MAX_TAG_LENGTH}
                value={tagInput}
                onChange={e => {
                  setTagInput(e.target.value);
                  setTagError(null);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        aria-label={t("removeTag", { tag })}
                        className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center md:min-h-0 md:min-w-0 md:my-0 md:mr-0"
                        onClick={() =>
                          setValue(
                            "tags",
                            tags.filter(x => x !== tag),
                            { shouldValidate: true },
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("tagsHelper")}</span>
                <span>{t("tagsCounter", { count: tags.length })}</span>
              </div>
              {tagError && <FieldError>{tagError}</FieldError>}
              {errors.tags && <FieldError>{errors.tags.message}</FieldError>}
            </Field>

            <Field data-invalid={errors.attested ? "true" : undefined}>
              <Controller
                control={control}
                name="attested"
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="listing-attested"
                      checked={field.value}
                      onCheckedChange={c => field.onChange(c === true)}
                      aria-invalid={!!errors.attested}
                    />
                    <FieldLabel htmlFor="listing-attested">
                      {t("attestation")}
                    </FieldLabel>
                  </div>
                )}
              />
              {errors.attested && (
                <FieldError>{errors.attested.message}</FieldError>
              )}
            </Field>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {t("cancel")}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={isSubmitting || !sellerReady || scopeBlocked}
              >
                {isSubmitting && <Loader2 className="animate-spin" />}
                {t(mode === "edit" ? "submitEdit" : "submitCreate")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
