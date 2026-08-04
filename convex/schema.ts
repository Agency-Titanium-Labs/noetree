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
});
