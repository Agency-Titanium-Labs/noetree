import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    picture: v.optional(v.string()),
    nickname: v.optional(v.string()),
    given_name: v.optional(v.string()),
    updated_at: v.optional(v.string()),
    family_name: v.optional(v.string()),
    phone_number: v.optional(v.string()),
    email_verified: v.optional(v.boolean()),
    phone_number_verified: v.optional(v.boolean()),
    role: v.id("roles"),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  roles: defineTable({
    role: v.string(),
  }),

  notes: defineTable({
    owner: v.id("users"),
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
    title: v.string(),
    content: v.string(),
    childNotes: v.optional(v.array(v.id("notes"))),
    parentNote: v.optional(v.id("notes")),
    index: v.optional(v.float64()),
    isPinned: v.optional(v.boolean()),
    // Public flag lives on the ROOT of a public subtree only; undefined = private.
    isPublic: v.optional(v.boolean()),
  })
    .index("by_owner", ["owner", "parentNote"])
    .index("by_parent", ["parentNote"]),

  subscriptions: defineTable({
    clerkUserId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
    ),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),

  // Idempotency note (07-RESEARCH.md Pitfall 3): the Connect event stream
  // (account.updated) reuses the existing processedStripeEvents table below
  // with a bare stripeEventId key. That is safe only because this phase's
  // handler is the sole consumer of account.updated events. If a future
  // phase adds a second consumer of the same event, it must suffix its own
  // idempotency key (e.g. `${event.id}:<operation>`, per the
  // grantInitialCredits/upsertSubscription precedent in aiCredits.ts) rather
  // than sharing this bare key.
  connectAccounts: defineTable({
    clerkUserId: v.string(),
    stripeAccountId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("restricted"),
    ),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
    // Stripe event.created (unix seconds) of the newest account.updated
    // applied to this row; older events are ignored (out-of-order delivery).
    // Optional so rows written before this field existed stay valid.
    lastEventCreated: v.optional(v.number()),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_stripeAccountId", ["stripeAccountId"]),

  aiCredits: defineTable({
    clerkUserId: v.string(),
    balance: v.number(),
    lastResetAt: v.number(),
  }).index("by_clerkUserId", ["clerkUserId"]),

  creditTransactions: defineTable({
    clerkUserId: v.string(),
    type: v.union(
      v.literal("deduction"),
      v.literal("topup"),
      v.literal("reset"),
      v.literal("refund"),
    ),
    amount: v.number(),
    createdAt: v.number(),
    stripePaymentIntentId: v.optional(v.string()),
  }).index("by_clerkUserId", ["clerkUserId"]),

  processedStripeEvents: defineTable({
    stripeEventId: v.string(),
    processedAt: v.number(),
    eventType: v.string(),
  }).index("by_stripeEventId", ["stripeEventId"]),

  shares: defineTable({
    noteId: v.id("notes"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    role: v.optional(
      v.union(v.literal("view"), v.literal("edit"), v.literal("admin")),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_note", ["noteId"])
    .index("by_email", ["email"])
    .index("by_user_note", ["userId", "noteId"])
    .index("by_email_note", ["email", "noteId"]),

  // shareLinks invariants (Phase 13):
  // - At most one row per noteId (D-01).
  // - token is a 256-bit CSPRNG bearer secret generated in a Node action,
  //   never a note _id (D-04).
  // - Revoke hard-deletes the row (D-03).
  // - A link grants access to that single note only, never descendants (D-02).
  shareLinks: defineTable({
    noteId: v.id("notes"),
    token: v.string(),
    role: v.union(v.literal("view"), v.literal("edit")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_noteId", ["noteId"]),

  // Listings invariants (Phase 8):
  // - One listing row per note for life (D-17): unpublish flips status, rows
  //   are never deleted so future purchases keep a valid reference (D-16/D-18).
  // - Public queries read ONLY snapshot fields on this row (D-07), never the
  //   live note.
  // - Every write to tags/status/priceCents/salesCount/searchText MUST call
  //   syncListingTags (convex/helpers/listings.ts) - Phase 9/10 included.
  // - Purchases/shares must never depend on listing.status (LIST-04).
  listings: defineTable({
    noteId: v.id("notes"),
    sellerId: v.id("users"),
    sellerClerkUserId: v.string(),
    sellerName: v.optional(v.string()),
    title: v.string(),
    description: v.string(),
    excerpt: v.string(),
    noteCount: v.number(),
    priceCents: v.number(),
    currency: v.literal("eur"),
    scope: v.union(v.literal("note"), v.literal("subtree")),
    accessMode: v.union(v.literal("copy"), v.literal("readonly")),
    // Bounded to 5 (LISTING_LIMITS.TAGS_MAX).
    tags: v.array(v.string()),
    status: v.union(v.literal("published"), v.literal("unpublished")),
    salesCount: v.number(),
    searchText: v.string(),
    attestedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_noteId", ["noteId"])
    .index("by_sellerId", ["sellerId"])
    .index("by_status", ["status"])
    .index("by_status_and_priceCents", ["status", "priceCents"])
    .index("by_status_and_salesCount", ["status", "salesCount"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["status"],
    }),

  // Per-tag join rows (max 5 per listing). Carries a copy of searchText so
  // q+tag browse is a paginated search with tag as a filter field (D-13).
  listingTags: defineTable({
    listingId: v.id("listings"),
    tag: v.string(),
    status: v.union(v.literal("published"), v.literal("unpublished")),
    priceCents: v.number(),
    salesCount: v.number(),
    listingCreatedAt: v.number(),
    searchText: v.string(),
  })
    .index("by_listingId", ["listingId"])
    .index("by_tag_and_status_and_listingCreatedAt", [
      "tag",
      "status",
      "listingCreatedAt",
    ])
    .index("by_tag_and_status_and_priceCents", ["tag", "status", "priceCents"])
    .index("by_tag_and_status_and_salesCount_and_listingCreatedAt", [
      "tag",
      "status",
      "salesCount",
      "listingCreatedAt",
    ])
    .searchIndex("search_text_by_tag", {
      searchField: "searchText",
      filterFields: ["tag", "status"],
    }),

  // Counter of PUBLISHED listings per tag; rows deleted when count hits 0.
  tagStats: defineTable({
    tag: v.string(),
    count: v.number(),
  })
    .index("by_tag", ["tag"])
    .index("by_count", ["count"]),
});
