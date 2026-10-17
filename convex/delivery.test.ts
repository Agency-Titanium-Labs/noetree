import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { MAX_COPY_BYTES, deliverPurchase, planCopy } from "./helpers/delivery";
import {
  seedListing,
  seedTree,
  seedUser,
  type T,
  type TreeSpec,
} from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

afterEach(() => {
  vi.restoreAllMocks();
});

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(
  opts: {
    tree?: TreeSpec;
    scope?: "note" | "subtree";
    accessMode?: "copy" | "readonly";
    noteCount?: number;
    buyerEmail?: string;
    status?: "pending" | "paid";
  } = {},
) {
  const t = convexTest(schema, modules);
  const sellerId = await seedUser(t, { key: "seller", connect: true });
  const buyerId = await seedUser(t, { key: "buyer", email: opts.buyerEmail });
  const { rootId, ids } = await seedTree(t, sellerId, opts.tree ?? {});
  const scope = opts.scope ?? "note";
  const accessMode = opts.accessMode ?? "copy";
  const noteCount = opts.noteCount ?? (scope === "note" ? 1 : ids.length);
  const listingId = await seedListing(t, {
    noteId: rootId,
    sellerId,
    sellerKey: "seller",
    scope,
    accessMode,
    noteCount,
  });
  const purchaseId = await insertPurchase(t, {
    buyerId,
    sellerId,
    listingId,
    noteId: rootId,
    scope,
    accessMode,
    noteCount,
    status: opts.status ?? "paid",
  });
  return { t, sellerId, buyerId, rootId, ids, listingId, purchaseId };
}

async function insertPurchase(
  t: T,
  o: {
    buyerId: Id<"users">;
    sellerId: Id<"users">;
    listingId: Id<"listings">;
    noteId: Id<"notes">;
    scope: "note" | "subtree";
    accessMode: "copy" | "readonly";
    noteCount: number;
    status: "pending" | "paid";
  },
) {
  return await t.run(ctx =>
    ctx.db.insert("purchases", {
      buyerId: o.buyerId,
      buyerClerkUserId: "buyer",
      listingId: o.listingId,
      noteId: o.noteId,
      sellerId: o.sellerId,
      sellerClerkUserId: "seller",
      status: o.status,
      title: "Pack",
      priceCents: 1000,
      currency: "eur",
      sellerTier: "free",
      commissionRateBps: 1500,
      commissionCents: 150,
      sellerNetCents: 850,
      scope: o.scope,
      accessMode: o.accessMode,
      noteCount: o.noteCount,
      destinationAccountId: "acct_seller",
      snapshotVersion: 1,
      snapshotAt: 1,
      ...(o.status === "paid" ? { paidAt: 2 } : {}),
    }),
  );
}

const deliver = (s: Setup) =>
  s.t.run(ctx => deliverPurchase(ctx, s.purchaseId));

async function buyerNotes(s: Setup) {
  return await s.t.run(ctx =>
    ctx.db
      .query("notes")
      .withIndex("by_owner", q => q.eq("owner", s.buyerId))
      .collect(),
  );
}

const allShares = (s: Setup) =>
  s.t.run(ctx => ctx.db.query("shares").collect());
const getPurchase = (s: Setup) =>
  s.t.run(ctx => ctx.db.get("purchases", s.purchaseId));
const getNote = (s: Setup, id: Id<"notes">) =>
  s.t.run(ctx => ctx.db.get("notes", id));

describe("copy note", () => {
  test("copies a single note at buyer root, private and unpinned", async () => {
    const s = await setup({
      tree: {
        title: "Original",
        content: "hello",
        index: 7,
        children: [{}, {}],
      },
    });
    await s.t.run(ctx =>
      ctx.db.patch("notes", s.rootId, { isPublic: true, isPinned: true }),
    );
    const before = await getNote(s, s.rootId);
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    const notes = await buyerNotes(s);
    expect(notes).toHaveLength(1);
    const copy = notes[0];
    expect(res.noteId).toBe(copy._id);
    expect(copy.parentNote).toBeUndefined();
    expect(copy.title).toBe("Original");
    expect(copy.content).toBe("hello");
    expect(copy.purchaseId).toBe(s.purchaseId);
    expect(copy.isPublic).toBeUndefined();
    expect(copy.isPinned).toBeUndefined();
    expect(copy.index).toBeUndefined();
    expect(copy.childNotes ?? []).toEqual([]);
    expect(typeof copy.created_at).toBe("string");
    const p = await getPurchase(s);
    expect(p?.deliveryStatus).toBe("delivered");
    expect(typeof p?.deliveredAt).toBe("number");
    expect(p?.deliveredNoteId).toBe(copy._id);
    expect(await allShares(s)).toHaveLength(0);
    expect(await getNote(s, s.rootId)).toEqual(before);
  });
});

describe("copy subtree", () => {
  test("recreates the whole subtree preserving structure and order", async () => {
    const s = await setup({
      scope: "subtree",
      tree: {
        title: "Root",
        index: 3,
        children: [
          {
            title: "A",
            index: 1,
            children: [
              { title: "A1", index: 1 },
              { title: "A2", index: 2 },
            ],
          },
          { title: "B", index: 2 },
        ],
      },
    });
    const sellerBefore = await s.t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_owner", q => q.eq("owner", s.sellerId))
        .collect(),
    );
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    const notes = await buyerNotes(s);
    expect(notes).toHaveLength(5);
    const byTitle = new Map(notes.map(n => [n.title, n]));
    const root = byTitle.get("Root")!;
    const a = byTitle.get("A")!;
    const b = byTitle.get("B")!;
    const a1 = byTitle.get("A1")!;
    const a2 = byTitle.get("A2")!;
    expect(root._id).toBe(res.noteId);
    expect(root.parentNote).toBeUndefined();
    expect(root.index).toBeUndefined();
    expect(root.childNotes).toEqual([a._id, b._id]);
    expect(a.childNotes).toEqual([a1._id, a2._id]);
    expect(a.parentNote).toBe(root._id);
    expect(a1.parentNote).toBe(a._id);
    expect(a.index).toBe(1);
    expect(b.index).toBe(2);
    expect(a2.index).toBe(2);
    expect(root.purchaseId).toBe(s.purchaseId);
    for (const n of [a, b, a1, a2]) expect(n.purchaseId).toBeUndefined();
    const sellerAfter = await s.t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_owner", q => q.eq("owner", s.sellerId))
        .collect(),
    );
    expect(sellerAfter).toEqual(sellerBefore);
  });
});

describe("snapshot cap", () => {
  test("copies only the first noteCount notes in pre-order", async () => {
    const s = await setup({
      scope: "subtree",
      noteCount: 3,
      tree: {
        title: "Root",
        children: [
          {
            title: "A",
            children: [{ title: "A1" }, { title: "A2" }],
          },
          { title: "B" },
          { title: "C" },
        ],
      },
    });
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    const notes = await buyerNotes(s);
    expect(notes.map(n => n.title).sort()).toEqual(["A", "A1", "Root"]);
    const ids = new Set(notes.map(n => n._id));
    for (const n of notes) {
      if (n.title !== "Root") expect(ids.has(n.parentNote!)).toBe(true);
    }
  });
});

describe("100 notes", () => {
  test("copies a 100 note subtree inside one transaction", async () => {
    const children: TreeSpec[] = Array.from({ length: 99 }, (_, i) => ({
      title: `c${i}`,
    }));
    const s = await setup({
      scope: "subtree",
      noteCount: 100,
      tree: { title: "Root", children },
    });
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    expect(await buyerNotes(s)).toHaveLength(100);
  });
});

describe("unsafe source", () => {
  test("skips descendants owned by a third user with their subtree", async () => {
    const s = await setup({
      scope: "subtree",
      noteCount: 4,
      tree: {
        title: "Root",
        children: [
          { title: "Mine" },
          { title: "Foreign", children: [{ title: "FChild" }] },
        ],
      },
    });
    const other = await seedUser(s.t, { key: "other" });
    await s.t.run(ctx => ctx.db.patch("notes", s.ids[2], { owner: other }));
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    const notes = await buyerNotes(s);
    expect(notes.map(n => n.title).sort()).toEqual(["Mine", "Root"]);
  });

  test("missing source fails with SOURCE_MISSING and logs", async () => {
    const s = await setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await s.t.run(ctx => ctx.db.delete("notes", s.rootId));
    const res = await deliver(s);
    expect(res).toMatchObject({ status: "failed", error: "SOURCE_MISSING" });
    expect(await buyerNotes(s)).toHaveLength(0);
    const p = await getPurchase(s);
    expect(p?.deliveryStatus).toBe("failed");
    expect(p?.deliveryError).toBe("SOURCE_MISSING");
    expect(spy).toHaveBeenCalled();
  });

  test("root owned by someone other than the seller fails", async () => {
    const s = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await seedUser(s.t, { key: "other" });
    await s.t.run(ctx => ctx.db.patch("notes", s.rootId, { owner: other }));
    const res = await deliver(s);
    expect(res).toMatchObject({
      status: "failed",
      error: "SOURCE_NOT_OWNED",
    });
    expect(await buyerNotes(s)).toHaveLength(0);
  });

  test("content budget exceeded yields CONTENT_TOO_LARGE with no writes", async () => {
    const s = await setup({
      scope: "subtree",
      tree: { title: "Root", children: [{ content: "x".repeat(20) }] },
    });
    expect(MAX_COPY_BYTES).toBe(8 * 1024 * 1024);
    const before = await s.t.run(ctx => ctx.db.query("notes").collect());
    const plan = await s.t.run(ctx =>
      planCopy(ctx, s.rootId, { maxBytes: 10 }),
    );
    expect(plan).toEqual({ ok: false, error: "CONTENT_TOO_LARGE" });
    const after = await s.t.run(ctx => ctx.db.query("notes").collect());
    expect(after).toHaveLength(before.length);
  });
});

describe("readonly grant", () => {
  test("inserts exactly one view share with lowercased email", async () => {
    const s = await setup({
      scope: "subtree",
      accessMode: "readonly",
      buyerEmail: "Buyer@Example.com",
      tree: { children: [{}] },
    });
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    const shares = await allShares(s);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({
      noteId: s.rootId,
      userId: s.buyerId,
      email: "buyer@example.com",
      role: "view",
      purchaseId: s.purchaseId,
      scope: "subtree",
    });
    const p = await getPurchase(s);
    expect(p?.deliveryStatus).toBe("delivered");
    expect(p?.deliveredNoteId).toBeUndefined();
    expect(await buyerNotes(s)).toHaveLength(0);
  });

  test("buyer without email gets empty email", async () => {
    const s = await setup({ accessMode: "readonly" });
    await deliver(s);
    const shares = await allShares(s);
    expect(shares).toHaveLength(1);
    expect(shares[0].email).toBe("");
  });
});

describe("idempotent helper", () => {
  test("second call is skipped and counts unchanged", async () => {
    const s = await setup();
    expect((await deliver(s)).status).toBe("delivered");
    const res = await deliver(s);
    expect(res.status).toBe("skipped");
    expect(await buyerNotes(s)).toHaveLength(1);
  });

  test("adopts an existing copy root", async () => {
    const s = await setup();
    const existing = await s.t.run(ctx =>
      ctx.db.insert("notes", {
        owner: s.buyerId,
        title: "x",
        content: "{}",
        purchaseId: s.purchaseId,
      }),
    );
    const res = await deliver(s);
    expect(res).toMatchObject({ status: "delivered", noteId: existing });
    expect(await buyerNotes(s)).toHaveLength(1);
    const p = await getPurchase(s);
    expect(p?.deliveryStatus).toBe("delivered");
    expect(p?.deliveredNoteId).toBe(existing);
  });

  test("adopts an existing share row", async () => {
    const s = await setup({ accessMode: "readonly" });
    await s.t.run(ctx =>
      ctx.db.insert("shares", {
        noteId: s.rootId,
        userId: s.buyerId,
        email: "",
        role: "view",
        purchaseId: s.purchaseId,
        scope: "note",
      }),
    );
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    expect(await allShares(s)).toHaveLength(1);
    expect((await getPurchase(s))?.deliveryStatus).toBe("delivered");
  });

  test("pending purchase is skipped and writes nothing", async () => {
    const s = await setup({ status: "pending" });
    const res = await deliver(s);
    expect(res.status).toBe("skipped");
    expect(await buyerNotes(s)).toHaveLength(0);
    expect((await getPurchase(s))?.deliveryStatus).toBeUndefined();
  });
});

describe("failed retry", () => {
  test("a failed purchase is delivered once the source exists", async () => {
    const s = await setup();
    await s.t.run(ctx =>
      ctx.db.patch("purchases", s.purchaseId, {
        deliveryStatus: "failed",
        deliveryError: "SOURCE_MISSING",
      }),
    );
    const res = await deliver(s);
    expect(res.status).toBe("delivered");
    const p = await getPurchase(s);
    expect(p?.deliveryStatus).toBe("delivered");
    expect(p?.deliveryError).toBeUndefined();
    expect(await buyerNotes(s)).toHaveLength(1);
  });
});
