// Shared convex-test seed helpers for Phase 10+ tests.
// Lives outside convex/ so it is never bundled as Convex functions.
import type { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export type T = ReturnType<typeof convexTest>;

export async function seedUser(
  t: T,
  opts: { key: string; connect?: boolean; email?: string },
): Promise<Id<"users">> {
  const { key, connect = false, email } = opts;
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      name: key,
      tokenIdentifier: `https://clerk.dev|${key}`,
      role: roleId,
      ...(email !== undefined ? { email } : {}),
    });
    if (connect) {
      await ctx.db.insert("connectAccounts", {
        clerkUserId: key,
        stripeAccountId: `acct_${key}`,
        status: "active",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
    }
    return userId;
  });
}

export function asUser(t: T, key: string) {
  return t.withIdentity({
    tokenIdentifier: `https://clerk.dev|${key}`,
    subject: key,
  });
}

export type TreeSpec = {
  title?: string;
  content?: string;
  index?: number;
  children?: TreeSpec[];
};

/**
 * Inserts a nested tree depth-first, then patches each parent's childNotes
 * with its children ids in creation order. `ids` is in pre-order.
 */
export async function seedTree(
  t: T,
  owner: Id<"users">,
  spec: TreeSpec,
): Promise<{ rootId: Id<"notes">; ids: Id<"notes">[] }> {
  return await t.run(async ctx => {
    const ids: Id<"notes">[] = [];
    const insert = async (
      node: TreeSpec,
      parent: Id<"notes"> | undefined,
    ): Promise<Id<"notes">> => {
      const id = await ctx.db.insert("notes", {
        owner,
        title: node.title ?? "Note",
        content: node.content ?? "{}",
        ...(node.index !== undefined ? { index: node.index } : {}),
        ...(parent ? { parentNote: parent } : {}),
      });
      ids.push(id);
      const childIds: Id<"notes">[] = [];
      for (const child of node.children ?? []) {
        childIds.push(await insert(child, id));
      }
      if (childIds.length > 0) {
        await ctx.db.patch("notes", id, { childNotes: childIds });
      }
      return id;
    };
    const rootId = await insert(spec, undefined);
    return { rootId, ids };
  });
}

export async function seedListing(
  t: T,
  opts: {
    noteId: Id<"notes">;
    sellerId: Id<"users">;
    sellerKey: string;
    scope?: "note" | "subtree";
    accessMode?: "copy" | "readonly";
    priceCents?: number;
    noteCount?: number;
    status?: "published" | "unpublished";
  },
): Promise<Id<"listings">> {
  return await t.run(async ctx =>
    ctx.db.insert("listings", {
      noteId: opts.noteId,
      sellerId: opts.sellerId,
      sellerClerkUserId: opts.sellerKey,
      title: "Pack",
      description: "desc",
      excerpt: "ex",
      noteCount: opts.noteCount ?? 1,
      priceCents: opts.priceCents ?? 1000,
      currency: "eur",
      scope: opts.scope ?? "note",
      accessMode: opts.accessMode ?? "copy",
      tags: [],
      status: opts.status ?? "published",
      salesCount: 0,
      searchText: "pack",
      attestedAt: 1,
      updatedAt: 1,
    }),
  );
}

export async function preparePendingPurchase(
  t: T,
  buyerKey: string,
  listingId: Id<"listings">,
): Promise<Id<"purchases">> {
  const res = await asUser(t, buyerKey).mutation(
    api.purchases.preparePurchase,
    { listingId },
  );
  return res.purchaseId;
}

export const paidArgs = (
  purchaseId: string,
  over: Record<string, unknown> = {},
) => ({
  stripeEventId: "evt_x",
  eventType: "checkout.session.completed",
  purchaseId,
  stripeCheckoutSessionId: "cs_1",
  amountTotal: 1000 as number | null,
  currency: "eur" as string | null,
  paymentStatus: "paid",
  stripePaymentIntentId: "pi_1",
  ...over,
});
