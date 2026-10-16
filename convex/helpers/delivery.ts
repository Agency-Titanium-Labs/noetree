/**
 * Purchase delivery core (Phase 10).
 *
 * Decisions implemented here:
 * - D-11: tree copying lives in one owner-parameterized pair (planCopy +
 *   writeCopy); plan 10-05 reuses it for duplicateNote.
 * - D-06/D-07/D-20: copy root lands at the buyer's root level with the original
 *   title; only title, content and sibling index are copied (the root's index
 *   is left unset); copies are private and unpinned, with fresh timestamps.
 * - D-08: only the copy root carries purchaseId.
 * - D-10: content is read live from the seller's notes at delivery time.
 * - D-15: at most purchase.noteCount notes are copied. "The first noteCount
 *   notes" means strict pre-order: parent before its children, siblings in
 *   parent.childNotes order then _creationTime, each child's whole subtree
 *   before the next sibling. Every copied note's parent is therefore copied.
 * - D-21: a read-only planning pass runs before any write (source exists, root
 *   owned by seller, noteCount cap, byte budget). Failures never write notes.
 * - D-01/D-19: read-only delivery inserts one shares row for the buyer.
 * - D-13: deliverPurchase is idempotent and adopts existing copy/share rows.
 * - D-17: data problems never throw; they mark the purchase failed.
 */
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_COPY_BYTES = 8 * 1024 * 1024;

export type DeliveryErrorCode =
  | "SOURCE_MISSING"
  | "SOURCE_NOT_OWNED"
  | "CONTENT_TOO_LARGE";

export type PlannedNote = { src: Doc<"notes">; parentIdx: number | null };

export async function planCopy(
  ctx: QueryCtx | MutationCtx,
  rootId: Id<"notes">,
  opts: {
    requiredOwner?: Id<"users">;
    maxNotes?: number;
    maxBytes?: number;
  },
): Promise<
  { ok: true; plan: PlannedNote[] } | { ok: false; error: DeliveryErrorCode }
> {
  const { requiredOwner, maxNotes, maxBytes } = opts;
  const root = await ctx.db.get("notes", rootId);
  if (!root) return { ok: false, error: "SOURCE_MISSING" };
  if (requiredOwner !== undefined && root.owner !== requiredOwner) {
    return { ok: false, error: "SOURCE_NOT_OWNED" };
  }

  const plan: PlannedNote[] = [];
  let bytes = 0;
  let tooLarge = false;

  const add = (src: Doc<"notes">, parentIdx: number | null): number | null => {
    bytes += src.content.length;
    if (maxBytes !== undefined && bytes > maxBytes) {
      tooLarge = true;
      return null;
    }
    plan.push({ src, parentIdx });
    return plan.length - 1;
  };

  const visit = async (node: Doc<"notes">, idx: number): Promise<void> => {
    const query = ctx.db
      .query("notes")
      .withIndex("by_parent", q => q.eq("parentNote", node._id));
    // maxNotes undefined => unbounded collect(), deliberately: this keeps
    // parity with user-initiated duplicateNote, which already collects
    // children unbounded. Delivery always passes a finite maxNotes.
    const children =
      maxNotes === undefined
        ? await query.collect()
        : await query.take(maxNotes + 1);

    // Same ordering rule as getTreeById: childNotes order first, then the
    // remaining children by _creationTime (index order is _creationTime asc).
    const byId = new Map(children.map(c => [c._id, c]));
    const ordered: Doc<"notes">[] = [];
    for (const id of node.childNotes ?? []) {
      const c = byId.get(id);
      if (c) {
        ordered.push(c);
        byId.delete(id);
      }
    }
    for (const c of children) {
      if (byId.has(c._id)) ordered.push(c);
    }

    for (const child of ordered) {
      if (tooLarge) return;
      if (maxNotes !== undefined && plan.length >= maxNotes) return;
      if (requiredOwner !== undefined && child.owner !== requiredOwner) {
        continue;
      }
      const childIdx = add(child, idx);
      if (childIdx === null) return;
      await visit(child, childIdx);
    }
  };

  const rootIdx = add(root, null);
  if (rootIdx === null) return { ok: false, error: "CONTENT_TOO_LARGE" };
  await visit(root, rootIdx);
  if (tooLarge) return { ok: false, error: "CONTENT_TOO_LARGE" };
  return { ok: true, plan };
}

export async function writeCopy(
  ctx: MutationCtx,
  plan: PlannedNote[],
  opts: {
    owner: Id<"users">;
    parentNote?: Id<"notes">;
    rootTitle?: string;
    purchaseId?: Id<"purchases">;
  },
): Promise<Id<"notes">> {
  const now = new Date().toISOString();
  const newIds: Id<"notes">[] = [];
  const childrenOf = new Map<number, Id<"notes">[]>();

  for (let i = 0; i < plan.length; i++) {
    const { src, parentIdx } = plan[i];
    const isRoot = i === 0;
    const id = await ctx.db.insert("notes", {
      owner: opts.owner,
      title: isRoot ? (opts.rootTitle ?? src.title) : src.title,
      content: src.content,
      childNotes: [],
      parentNote: isRoot
        ? opts.parentNote
        : parentIdx !== null
          ? newIds[parentIdx]
          : undefined,
      created_at: now,
      updated_at: now,
      ...(!isRoot && src.index !== undefined ? { index: src.index } : {}),
      ...(isRoot && opts.purchaseId ? { purchaseId: opts.purchaseId } : {}),
    });
    newIds.push(id);
    if (!isRoot && parentIdx !== null) {
      const list = childrenOf.get(parentIdx) ?? [];
      list.push(id);
      childrenOf.set(parentIdx, list);
    }
  }

  for (const [parentIdx, childNotes] of childrenOf) {
    await ctx.db.patch("notes", newIds[parentIdx], { childNotes });
  }
  return newIds[0];
}

type DeliveryResult = {
  status: "delivered" | "failed" | "skipped";
  noteId?: Id<"notes">;
  error?: DeliveryErrorCode;
};

async function markDelivered(
  ctx: MutationCtx,
  purchaseId: Id<"purchases">,
  noteId?: Id<"notes">,
): Promise<DeliveryResult> {
  await ctx.db.patch("purchases", purchaseId, {
    deliveredAt: Date.now(),
    deliveryStatus: "delivered",
    deliveredNoteId: noteId,
    deliveryError: undefined,
  });
  return { status: "delivered", noteId };
}

async function markFailed(
  ctx: MutationCtx,
  purchaseId: Id<"purchases">,
  error: DeliveryErrorCode,
): Promise<DeliveryResult> {
  await ctx.db.patch("purchases", purchaseId, {
    deliveryStatus: "failed",
    deliveryError: error,
  });
  console.error(
    `marketplace delivery anomaly: purchase=${purchaseId} code=${error}`,
  );
  return { status: "failed", error };
}

export async function deliverPurchase(
  ctx: MutationCtx,
  purchaseId: Id<"purchases">,
): Promise<DeliveryResult> {
  const p = await ctx.db.get("purchases", purchaseId);
  if (
    !p ||
    p.status !== "paid" ||
    p.deliveredAt !== undefined ||
    p.deliveryStatus === "delivered"
  ) {
    return { status: "skipped" };
  }

  if (p.accessMode === "copy") {
    const existing = await ctx.db
      .query("notes")
      .withIndex("by_purchaseId", q => q.eq("purchaseId", p._id))
      .first();
    if (existing) return await markDelivered(ctx, p._id, existing._id);

    const planned = await planCopy(ctx, p.noteId, {
      requiredOwner: p.sellerId,
      maxNotes: p.scope === "note" ? 1 : p.noteCount,
      maxBytes: MAX_COPY_BYTES,
    });
    if (!planned.ok) return await markFailed(ctx, p._id, planned.error);
    const rootId = await writeCopy(ctx, planned.plan, {
      owner: p.buyerId,
      purchaseId: p._id,
    });
    return await markDelivered(ctx, p._id, rootId);
  }

  const existingShare = await ctx.db
    .query("shares")
    .withIndex("by_purchaseId", q => q.eq("purchaseId", p._id))
    .first();
  if (existingShare) return await markDelivered(ctx, p._id);

  const source = await ctx.db.get("notes", p.noteId);
  if (!source) return await markFailed(ctx, p._id, "SOURCE_MISSING");
  if (source.owner !== p.sellerId) {
    return await markFailed(ctx, p._id, "SOURCE_NOT_OWNED");
  }
  const buyer = await ctx.db.get("users", p.buyerId);
  await ctx.db.insert("shares", {
    noteId: p.noteId,
    userId: p.buyerId,
    email: buyer?.email?.trim().toLowerCase() ?? "",
    role: "view",
    purchaseId: p._id,
    scope: p.scope,
  });
  return await markDelivered(ctx, p._id);
}
