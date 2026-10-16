import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";

export const LISTING_LIMITS = {
  TITLE_MAX: 100,
  DESCRIPTION_MAX: 1000,
  PRICE_MIN_CENTS: 100,
  PRICE_MAX_CENTS: 50000,
  TAGS_MAX: 5,
  TAG_MAX_LENGTH: 24,
  SUBTREE_CAP: 100,
  EXCERPT_MAX: 300,
  SEARCH_QUERY_MAX: 100,
  PAGE_SIZE_MAX: 50,
} as const;

export type ListingStatus = "published" | "unpublished";
export type ListingScope = "note" | "subtree";
export type ListingAccessMode = "copy" | "readonly";

type TipTapNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

/**
 * Derives a plain-text excerpt from TipTap JSON. Only `text` of text nodes is
 * read - attrs (image src, link href) and marks are never touched (T-08-01).
 * Malformed/empty content yields "".
 */
export function extractExcerpt(
  content: string,
  max: number = LISTING_LIMITS.EXCERPT_MAX,
): string {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return "";
  }

  const parts: string[] = [];
  let length = 0;
  const limit = max + 50;

  const walk = (node: unknown): void => {
    if (length > limit || node === null || typeof node !== "object") return;
    const n = node as TipTapNode;
    if (n.type === "text") {
      if (typeof n.text === "string") {
        parts.push(n.text);
        length += n.text.length;
      }
      return;
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        walk(child);
        if (length > limit) return;
      }
      parts.push(" ");
      length += 1;
    }
  };
  walk(doc);

  const text = parts.join("").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;

  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max - 40 ? lastSpace : max;
  return slice.slice(0, cut).trimEnd() + "…";
}

export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const tag = entry.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  if (
    result.length > LISTING_LIMITS.TAGS_MAX ||
    result.some(t => t.length > LISTING_LIMITS.TAG_MAX_LENGTH)
  ) {
    throw new ConvexError("LISTING_INVALID_TAGS");
  }
  return result;
}

export function validateListingFields(input: {
  title: string;
  description: string;
  priceCents: number;
}): { title: string; description: string; priceCents: number } {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 1 || title.length > LISTING_LIMITS.TITLE_MAX) {
    throw new ConvexError("LISTING_INVALID_FIELD");
  }
  if (
    description.length < 1 ||
    description.length > LISTING_LIMITS.DESCRIPTION_MAX
  ) {
    throw new ConvexError("LISTING_INVALID_FIELD");
  }
  const { priceCents } = input;
  if (
    !Number.isInteger(priceCents) ||
    priceCents < LISTING_LIMITS.PRICE_MIN_CENTS ||
    priceCents > LISTING_LIMITS.PRICE_MAX_CENTS
  ) {
    throw new ConvexError("LISTING_INVALID_PRICE");
  }
  return { title, description, priceCents };
}

export function buildSearchText(
  title: string,
  description: string,
  tags: string[],
): string {
  return title + "\n" + description + "\n" + tags.join(" ");
}

export type PublicListing = {
  _id: Id<"listings">;
  _creationTime: number;
  title: string;
  description: string;
  excerpt: string;
  noteCount: number;
  priceCents: number;
  currency: "eur";
  scope: ListingScope;
  accessMode: ListingAccessMode;
  tags: string[];
  salesCount: number;
  sellerName: string | null;
};

/** Explicit projection - never spread the doc (T-08-02). */
export function toPublicListing(doc: Doc<"listings">): PublicListing {
  return {
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: doc.title,
    description: doc.description,
    excerpt: doc.excerpt,
    noteCount: doc.noteCount,
    priceCents: doc.priceCents,
    currency: doc.currency,
    scope: doc.scope,
    accessMode: doc.accessMode,
    tags: doc.tags,
    salesCount: doc.salesCount,
    sellerName: doc.sellerName ?? null,
  };
}
