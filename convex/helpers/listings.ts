import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { flattenTipTap } from "./noteText";
import { isPurchasedNote } from "./purchasedFlag";

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

/**
 * Derives a plain-text excerpt from TipTap JSON. Only `text` of text nodes is
 * read - attrs (image src, link href) and marks are never touched (T-08-01).
 * Malformed/empty content yields "".
 */
export function extractExcerpt(
  content: string,
  max: number = LISTING_LIMITS.EXCERPT_MAX,
): string {
  const text = flattenTipTap(content, " ", max + 50)
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Bounded BFS over the note subtree. Rejects >cap notes and any descendant not
 * owned by the seller (T-08-03, T-08-04). Never uses an unbounded read.
 */
export async function countSubtree(
  ctx: QueryCtx,
  rootId: Id<"notes">,
  sellerId: Id<"users">,
  cap: number = LISTING_LIMITS.SUBTREE_CAP,
): Promise<number> {
  let count = 1;
  let frontier: Id<"notes">[] = [rootId];
  while (frontier.length > 0) {
    const next: Id<"notes">[] = [];
    for (const id of frontier) {
      const children = await ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", id))
        .take(cap + 1);
      for (const child of children) {
        if (child.owner !== sellerId) {
          throw new ConvexError("LISTING_CONTAINS_FOREIGN_NOTES");
        }
        // A flagged purchased note moved under the listed subtree.
        if (isPurchasedNote(child)) {
          throw new ConvexError("LISTING_PURCHASED_CONTENT");
        }
        count++;
        if (count > cap) {
          throw new ConvexError("LISTING_SUBTREE_TOO_LARGE");
        }
        next.push(child._id);
      }
    }
    frontier = next;
  }
  return count;
}

export async function buildSnapshot(
  ctx: QueryCtx,
  args: { note: Doc<"notes">; sellerId: Id<"users">; scope: ListingScope },
): Promise<{ excerpt: string; noteCount: number }> {
  const excerpt = extractExcerpt(args.note.content, LISTING_LIMITS.EXCERPT_MAX);
  const noteCount =
    args.scope === "note"
      ? 1
      : await countSubtree(ctx, args.note._id, args.sellerId);
  return { excerpt, noteCount };
}

/**
 * Mirrors a listing's tags/status/price/sales/searchText into listingTags and
 * keeps tagStats (published-listing counts per tag) in step.
 *
 * ALL writes to listing tags/status/priceCents/salesCount/searchText must call
 * this (Phase 9/10 salesCount increments included).
 *
 * OCC note: tagStats rows are hot counters. Concurrent publishes/unpublishes/
 * sales touching the same popular tag conflict (OCC) and are retried by
 * Convex; acceptable at Phase 8 volume. Phase 9/10 must NOT increment
 * salesCount for many listings in one mutation, and should revisit (e.g.
 * @convex-dev/aggregate or sharded counters) if sale volume makes tagStats a
 * contention hotspot.
 */
export async function syncListingTags(
  ctx: MutationCtx,
  listingId: Id<"listings">,
): Promise<void> {
  const listing = await ctx.db.get("listings", listingId);
  if (!listing) return;

  const rows = await ctx.db
    .query("listingTags")
    .withIndex("by_listingId", q => q.eq("listingId", listingId))
    .take(LISTING_LIMITS.TAGS_MAX * 2);

  const prevCounted = new Set(
    rows.filter(r => r.status === "published").map(r => r.tag),
  );
  const nextCounted = new Set<string>(
    listing.status === "published" ? listing.tags : [],
  );
  const wanted = new Set(listing.tags);
  const mirrored = {
    status: listing.status,
    priceCents: listing.priceCents,
    salesCount: listing.salesCount,
    listingCreatedAt: listing._creationTime,
    searchText: listing.searchText,
  };

  const existingTags = new Set<string>();
  for (const row of rows) {
    if (!wanted.has(row.tag) || existingTags.has(row.tag)) {
      await ctx.db.delete("listingTags", row._id);
    } else {
      existingTags.add(row.tag);
      await ctx.db.patch("listingTags", row._id, mirrored);
    }
  }
  for (const tag of wanted) {
    if (!existingTags.has(tag)) {
      await ctx.db.insert("listingTags", { listingId, tag, ...mirrored });
    }
  }

  for (const tag of nextCounted) {
    if (prevCounted.has(tag)) continue;
    const stat = await ctx.db
      .query("tagStats")
      .withIndex("by_tag", q => q.eq("tag", tag))
      .unique();
    if (stat) {
      await ctx.db.patch("tagStats", stat._id, { count: stat.count + 1 });
    } else {
      await ctx.db.insert("tagStats", { tag, count: 1 });
    }
  }
  for (const tag of prevCounted) {
    if (nextCounted.has(tag)) continue;
    const stat = await ctx.db
      .query("tagStats")
      .withIndex("by_tag", q => q.eq("tag", tag))
      .unique();
    if (!stat) continue;
    if (stat.count - 1 <= 0) {
      await ctx.db.delete("tagStats", stat._id);
    } else {
      await ctx.db.patch("tagStats", stat._id, { count: stat.count - 1 });
    }
  }
}

/** D-18: unpublish (never delete) the listing for a note. No-op if none. */
export async function unpublishListingForNote(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<void> {
  const listing = await ctx.db
    .query("listings")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .unique();
  if (!listing || listing.status !== "published") return;
  await ctx.db.patch("listings", listing._id, {
    status: "unpublished",
    updatedAt: Date.now(),
  });
  await syncListingTags(ctx, listing._id);
}

const MAX_ANCESTOR_HOPS = 64;

/**
 * True when the note or any ancestor (bounded to 64 hops) is purchased content
 * per the shared predicate (purchaseId OR isPurchasedContent).
 */
export async function isNoteOrAncestorPurchased(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<boolean> {
  let currentId: Id<"notes"> | undefined = noteId;
  for (let hops = 0; currentId && hops < MAX_ANCESTOR_HOPS; hops++) {
    const current: Doc<"notes"> | null = await ctx.db.get("notes", currentId);
    if (!current) break;
    if (isPurchasedNote(current)) return true;
    currentId = current.parentNote;
  }
  return false;
}

/**
 * D-09 / D-21: purchased content cannot be re-listed.
 *  (a) the note or any ancestor (bounded to 64 hops) carries purchaseId, or
 *  (b) the note's subtree contains one of the caller's delivered copy roots
 *      (a purchased copy the buyer moved under it).
 * Check (b) walks up from each delivered root instead of down from the note,
 * so no unbounded subtree read is needed.
 */
export async function assertNotPurchasedContent(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<void> {
  // (a) ancestor walk, inclusive of noteId. "Purchased" is the shared
  // predicate (purchaseId OR isPurchasedContent), so a purchased sub-note
  // moved out of its copy stays unsellable (18-CONTEXT D-06).
  if (await isNoteOrAncestorPurchased(ctx, noteId)) {
    throw new ConvexError("LISTING_PURCHASED_CONTENT");
  }

  // (b) delivered copy roots of this buyer. The cap of 500 purchases per buyer
  // is far beyond expected volume.
  const purchases = await ctx.db
    .query("purchases")
    .withIndex("by_buyerId", q => q.eq("buyerId", userId))
    .take(500);
  for (const purchase of purchases) {
    if (!purchase.deliveredNoteId) continue;
    const root = await ctx.db.get("notes", purchase.deliveredNoteId);
    if (!root) continue;
    let ancestorId: Id<"notes"> | undefined = root.parentNote;
    for (let hops = 0; ancestorId && hops < MAX_ANCESTOR_HOPS; hops++) {
      if (ancestorId === noteId) {
        throw new ConvexError("LISTING_PURCHASED_CONTENT");
      }
      const ancestor: Doc<"notes"> | null = await ctx.db.get(
        "notes",
        ancestorId,
      );
      if (!ancestor) break;
      ancestorId = ancestor.parentNote;
    }
  }
}
