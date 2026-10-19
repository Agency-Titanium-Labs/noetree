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
    // D-08: set on a purchase copy root so it can be found by its purchase.
    purchaseId: v.optional(v.id("purchases")),
    // Phase 15: user who last saved the current content (author of the next
    // snapshot of this content). Optional so no migration is needed.
    lastEditedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["owner", "parentNote"])
    .index("by_parent", ["parentNote"])
    .index("by_purchaseId", ["purchaseId"]),

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
    // MONTHLY bucket (D-01)
    balance: v.number(),
    // PURCHASED bucket (D-01); absent == 0; never touched by monthly resets
    purchasedBalance: v.optional(v.number()),
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
    // Signed change to the monthly bucket (amount stays the signed total)
    monthlyDelta: v.optional(v.number()),
    // Signed change to the purchased bucket
    purchasedDelta: v.optional(v.number()),
    actionKey: v.optional(v.string()),
    packKey: v.optional(v.string()),
    refundsTransactionId: v.optional(v.id("creditTransactions")),
    // Phase 17: the AI run this deduction/refund belongs to (audit only).
    aiRunId: v.optional(v.id("aiRuns")),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_clerkUserId_and_type", ["clerkUserId", "type"])
    // Phase 17: second line of defence, a deduction can be refunded once.
    .index("by_refundsTransactionId", ["refundsTransactionId"]),

  // AI run metering (Phase 17). Invariants:
  // - One row per (clerkUserId, requestId): a replay never debits twice.
  // - Inserted only by aiRuns.beginRun, in the same transaction as the debit.
  // - status leaves "reserved" exactly once (compare-and-set in settle/expire).
  // - fromMonthly/fromPurchased/transactionId are the original Draw so a
  //   refund restores exactly what each bucket paid.
  // - Never exposes prompts or completions: only ids, costs and token usage.
  aiRuns: defineTable({
    clerkUserId: v.string(),
    requestId: v.string(),
    actionKey: v.string(),
    cost: v.number(),
    status: v.union(
      v.literal("reserved"),
      v.literal("completed"),
      v.literal("refunded"),
    ),
    transactionId: v.id("creditTransactions"),
    fromMonthly: v.number(),
    fromPurchased: v.number(),
    createdAt: v.number(),
    // Set by beginRun when the run is created: the creating call is the only
    // one allowed to stream (single owner). Replays never get a claim.
    streamClaimedAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    outcome: v.optional(v.string()),
    refundTransactionId: v.optional(v.id("creditTransactions")),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
      }),
    ),
  })
    .index("by_clerkUserId_and_requestId", ["clerkUserId", "requestId"])
    .index("by_clerkUserId_and_status", ["clerkUserId", "status"])
    .index("by_status_and_createdAt", ["status", "createdAt"]),

  // Operator kill switch (Phase 17). Singleton row keyed "global"; absent
  // means AI is enabled. Flipped from the Convex dashboard through the
  // internal mutation aiRuns.setAiEnabled, no redeploy needed.
  aiConfig: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Per-user token bucket + operator block (Phase 17).
  aiRateLimits: defineTable({
    clerkUserId: v.string(),
    tokens: v.number(),
    updatedAt: v.number(),
    blockedUntil: v.optional(v.number()),
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
    // D-01: purchase-granted shares carry the purchase and its scope.
    // undefined purchaseId = manual share (existing rows stay valid).
    purchaseId: v.optional(v.id("purchases")),
    scope: v.optional(v.union(v.literal("note"), v.literal("subtree"))),
  })
    .index("by_user", ["userId"])
    .index("by_note", ["noteId"])
    .index("by_email", ["email"])
    .index("by_user_note", ["userId", "noteId"])
    .index("by_email_note", ["email", "noteId"])
    .index("by_purchaseId", ["purchaseId"])
    .index("by_note_and_purchaseId", ["noteId", "purchaseId"]),

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

  // Comments / notifications invariants (Phase 14):
  // - Comments are note-level only (no block anchors).
  // - parentId is set only on replies and ALWAYS points at a root comment (D-07).
  // - Thread state (resolvedAt/resolvedBy) lives on the root row only (D-08).
  // - A root with replies is tombstoned via deletedAt with body "" (D-09).
  // - comments and notifications are NEVER written, filtered, copied or
  //   restored by note snapshot/restore/duplicate/purchase logic, and no
  //   comment field may be added to notes (D-11, COMMENT-04, Phase 15 guardrail).
  // - notifications store kind, not display text (D-13).
  comments: defineTable({
    noteId: v.id("notes"),
    authorId: v.id("users"),
    parentId: v.optional(v.id("comments")),
    body: v.string(),
    deletedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
  })
    .index("by_noteId", ["noteId"])
    .index("by_parentId", ["parentId"])
    .index("by_authorId", ["authorId"]),

  notifications: defineTable({
    recipientId: v.id("users"),
    actorId: v.id("users"),
    noteId: v.id("notes"),
    commentId: v.id("comments"),
    kind: v.union(v.literal("comment"), v.literal("reply")),
    readAt: v.optional(v.number()),
  })
    .index("by_recipientId", ["recipientId"])
    .index("by_recipientId_and_readAt", ["recipientId", "readAt"])
    .index("by_noteId", ["noteId"])
    .index("by_commentId", ["commentId"]),

  // Version history invariants (Phase 15):
  // - Version rows are immutable (never patched).
  // - Metadata (noteVersions) and payload (noteVersionContents) are split so
  //   list queries never read note bodies.
  // - createdAt (ms) is explicit (not _creationTime) so the gate/window are
  //   testable.
  // - The Free 24h window is enforced at READ time only; nothing prunes rows
  //   (D-05).
  // - Only content changes snapshot; title is display-only (D-04).
  // - Snapshot/restore code never touches comments or notifications (D-14).
  noteVersions: defineTable({
    noteId: v.id("notes"),
    title: v.string(),
    authorId: v.optional(v.id("users")),
    isPreRestore: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_noteId_and_createdAt", ["noteId", "createdAt"]),

  noteVersionContents: defineTable({
    versionId: v.id("noteVersions"),
    noteId: v.id("notes"),
    content: v.string(),
  })
    .index("by_versionId", ["versionId"])
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

  // Marketplace purchases (Phase 9).
  // Invariants:
  // - One row per (buyer, listing), enforced inside preparePurchase's transaction.
  // - status goes pending -> paid only via the signature-verified Stripe webhook.
  // - The webhook never recomputes the fee (D-11): it reads this snapshot.
  // - The webhook never reads listing.status (D-09, LIST-04).
  // - _id is the Phase 10 delivery idempotency key (D-04).
  // - No refund status exists (D-14, sales are final). No quota fields (D-07 superseded).
  purchases: defineTable({
    buyerId: v.id("users"),
    buyerClerkUserId: v.string(),
    listingId: v.id("listings"),
    noteId: v.id("notes"),
    sellerId: v.id("users"),
    sellerClerkUserId: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid")),
    // Snapshot taken at prepare time
    title: v.string(),
    priceCents: v.number(),
    currency: v.literal("eur"),
    sellerTier: v.union(v.literal("free"), v.literal("premium")),
    commissionRateBps: v.number(),
    commissionCents: v.number(),
    sellerNetCents: v.number(),
    // Phase 23: VAT absorbed by the seller. Optional so v1.1/v1.2 rows stay
    // valid; undefined reads as 0 (no backfill of history).
    vatRateBps: v.optional(v.number()),
    vatCents: v.optional(v.number()),
    scope: v.union(v.literal("note"), v.literal("subtree")),
    accessMode: v.union(v.literal("copy"), v.literal("readonly")),
    noteCount: v.number(),
    destinationAccountId: v.string(),
    // Incremented each time the snapshot is (re)taken; part of the Stripe idempotency key.
    snapshotVersion: v.number(),
    // ms; drives a deterministic Stripe expires_at.
    snapshotAt: v.number(),
    // Stripe linkage
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    // Phase 10 delivery bookkeeping (D-13). All optional: rows written before
    // this field existed stay valid.
    deliveredAt: v.optional(v.number()),
    deliveryStatus: v.optional(
      v.union(v.literal("delivered"), v.literal("failed")),
    ),
    deliveredNoteId: v.optional(v.id("notes")),
    deliveryError: v.optional(v.string()),
  })
    .index("by_buyerId_and_listingId", ["buyerId", "listingId"])
    .index("by_stripeCheckoutSessionId", ["stripeCheckoutSessionId"])
    .index("by_listingId", ["listingId"])
    .index("by_sellerId", ["sellerId"])
    .index("by_buyerId", ["buyerId"])
    // D-13/D-16: backfill of paid purchases not yet delivered.
    .index("by_status_and_deliveryStatus", ["status", "deliveryStatus"])
    // Phase 11 (HIST-01/02): paid-only, newest paidAt first history lists.
    .index("by_buyerId_and_status_and_paidAt", ["buyerId", "status", "paidAt"])
    .index("by_sellerId_and_status_and_paidAt", [
      "sellerId",
      "status",
      "paidAt",
    ]),

  // Seller lifetime totals (Phase 11 D-12). Invariants:
  // - One row per seller.
  // - Written only by addSaleToEarnings inside markPaidFromCheckout (exactly
  //   once per pending-to-paid transition) and by the internal recompute/backfill.
  // - Values are sums of purchase snapshots (D-09/D-12), never recomputed from tier.
  // - Never exposed through a public mutation.
  sellerEarnings: defineTable({
    sellerId: v.id("users"),
    saleCount: v.number(),
    grossCents: v.number(),
    commissionCents: v.number(),
    netCents: v.number(),
    // Phase 23: undefined reads as 0.
    vatCents: v.optional(v.number()),
  }).index("by_sellerId", ["sellerId"]),
});
