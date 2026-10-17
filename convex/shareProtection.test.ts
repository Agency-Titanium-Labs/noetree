import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  asUser,
  preparePendingPurchase,
  seedListing,
  seedTree,
  seedUser,
} from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

async function setup(tree: Parameters<typeof seedTree>[2] = {}) {
  const t = convexTest(schema, modules);
  const sellerId = await seedUser(t, {
    key: "seller",
    connect: true,
    email: "seller@x.com",
  });
  const buyerId = await seedUser(t, { key: "buyer", email: "buyer@x.com" });
  const { rootId, ids } = await seedTree(t, sellerId, tree);
  const listingId = await seedListing(t, {
    noteId: rootId,
    sellerId,
    sellerKey: "seller",
  });
  const purchaseId = await preparePendingPurchase(t, "buyer", listingId);
  return { t, sellerId, buyerId, rootId, ids, listingId, purchaseId };
}

async function insertPurchaseShare(
  t: ReturnType<typeof convexTest>,
  noteId: Id<"notes">,
  buyerId: Id<"users">,
  purchaseId: Id<"purchases">,
  scope: "note" | "subtree",
  email = "buyer@x.com",
) {
  return await t.run(ctx =>
    ctx.db.insert("shares", {
      noteId,
      userId: buyerId,
      email,
      role: "view",
      purchaseId,
      scope,
    }),
  );
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return (e as { data?: unknown }).data ?? (e as Error).message;
  }
  return undefined;
}

describe("share protection", () => {
  test("seller and buyer cannot remove a purchase share", async () => {
    const { t, rootId, buyerId, purchaseId } = await setup();
    const p = await insertPurchaseShare(
      t,
      rootId,
      buyerId,
      purchaseId,
      "subtree",
    );
    expect(
      await errorOf(
        asUser(t, "seller").mutation(api.notes.removeShare, { shareId: p }),
      ),
    ).toBe("SHARE_PROTECTED");
    expect(
      await errorOf(
        asUser(t, "buyer").mutation(api.notes.removeShare, { shareId: p }),
      ),
    ).toBe("SHARE_PROTECTED");
    expect(await t.run(ctx => ctx.db.get("shares", p))).not.toBeNull();
  });

  test("updateShareRole is rejected and role is unchanged", async () => {
    const { t, rootId, buyerId, purchaseId } = await setup();
    const p = await insertPurchaseShare(
      t,
      rootId,
      buyerId,
      purchaseId,
      "subtree",
    );
    expect(
      await errorOf(
        asUser(t, "seller").mutation(api.notes.updateShareRole, {
          shareId: p,
          role: "edit",
        }),
      ),
    ).toBe("SHARE_PROTECTED");
    const row = await t.run(ctx => ctx.db.get("shares", p));
    expect(row?.role).toBe("view");
  });

  test("inviteUser adds a separate manual share, second invite is ALREADY_SHARED", async () => {
    const { t, rootId, buyerId, purchaseId } = await setup();
    const p = await insertPurchaseShare(
      t,
      rootId,
      buyerId,
      purchaseId,
      "subtree",
    );
    const first = await asUser(t, "seller").mutation(api.notes.inviteUser, {
      noteId: rootId,
      email: "buyer@x.com",
      role: "edit",
    });
    expect(first.success).toBe(true);
    const second = await asUser(t, "seller").mutation(api.notes.inviteUser, {
      noteId: rootId,
      email: "buyer@x.com",
      role: "edit",
    });
    expect(second).toMatchObject({ success: false, error: "ALREADY_SHARED" });
    const rows = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_note", q => q.eq("noteId", rootId))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    const purchaseRow = rows.find(r => r._id === p);
    expect(purchaseRow?.role).toBe("view");
    expect(purchaseRow?.purchaseId).toBe(purchaseId);
  });

  test("getNoteShares hides purchase shares from seller and buyer", async () => {
    const { t, rootId, buyerId, purchaseId } = await setup();
    await insertPurchaseShare(t, rootId, buyerId, purchaseId, "subtree");
    await asUser(t, "seller").mutation(api.notes.inviteUser, {
      noteId: rootId,
      email: "friend@x.com",
      role: "view",
    });
    const asSeller = await asUser(t, "seller").query(api.notes.getNoteShares, {
      noteId: rootId,
    });
    expect(asSeller.shares.map(s => s.email).sort()).toEqual([
      "friend@x.com",
      "seller@x.com",
    ]);
    const asBuyer = await asUser(t, "buyer").query(api.notes.getNoteShares, {
      noteId: rootId,
    });
    expect(asBuyer.shares.map(s => s.email)).not.toContain("buyer@x.com");
  });

  test("manual shares remain removable and role-changeable", async () => {
    const { t, rootId } = await setup();
    const res = await asUser(t, "seller").mutation(api.notes.inviteUser, {
      noteId: rootId,
      email: "friend@x.com",
      role: "view",
    });
    const shareId = res.share!._id;
    await asUser(t, "seller").mutation(api.notes.updateShareRole, {
      shareId,
      role: "edit",
    });
    expect((await t.run(ctx => ctx.db.get("shares", shareId)))?.role).toBe(
      "edit",
    );
    await asUser(t, "seller").mutation(api.notes.removeShare, { shareId });
    expect(await t.run(ctx => ctx.db.get("shares", shareId))).toBeNull();
  });
});

describe("delete guard", () => {
  test("deleting a note with a purchase share is rejected", async () => {
    const { t, rootId, ids, buyerId, purchaseId, listingId } = await setup({
      children: [{}],
    });
    await insertPurchaseShare(t, rootId, buyerId, purchaseId, "subtree");
    expect(
      await errorOf(
        asUser(t, "seller").mutation(api.notes.deleteNote, { id: rootId }),
      ),
    ).toBe("NOTE_HAS_PURCHASE_GRANTS");
    for (const id of ids) {
      expect(await t.run(ctx => ctx.db.get("notes", id))).not.toBeNull();
    }
    expect(
      (await t.run(ctx => ctx.db.get("listings", listingId)))?.status,
    ).toBe("published");
  });

  test("deleting an ancestor of a shared note is rejected", async () => {
    const { t, ids, buyerId, purchaseId } = await setup({
      children: [{ children: [{}] }],
    });
    await insertPurchaseShare(t, ids[2], buyerId, purchaseId, "note");
    expect(
      await errorOf(
        asUser(t, "seller").mutation(api.notes.deleteNote, { id: ids[0] }),
      ),
    ).toBe("NOTE_HAS_PURCHASE_GRANTS");
    expect(await t.run(ctx => ctx.db.get("notes", ids[0]))).not.toBeNull();
  });

  test("child of subtree-scope share is rejected, of note-scope is allowed", async () => {
    const sub = await setup({ children: [{}] });
    await insertPurchaseShare(
      sub.t,
      sub.rootId,
      sub.buyerId,
      sub.purchaseId,
      "subtree",
    );
    expect(
      await errorOf(
        asUser(sub.t, "seller").mutation(api.notes.deleteNote, {
          id: sub.ids[1],
        }),
      ),
    ).toBe("NOTE_HAS_PURCHASE_GRANTS");

    const one = await setup({ children: [{}] });
    await insertPurchaseShare(
      one.t,
      one.rootId,
      one.buyerId,
      one.purchaseId,
      "note",
    );
    await asUser(one.t, "seller").mutation(api.notes.deleteNote, {
      id: one.ids[1],
    });
    expect(await one.t.run(ctx => ctx.db.get("notes", one.ids[1]))).toBeNull();
  });

  test("blocking subtree share is found behind 30 note-scope shares", async () => {
    const { t, ids, rootId, buyerId, purchaseId } = await setup({
      children: [{}],
    });
    for (let i = 0; i < 30; i++) {
      await insertPurchaseShare(
        t,
        rootId,
        buyerId,
        purchaseId,
        "note",
        `n${i}@x.com`,
      );
    }
    await insertPurchaseShare(t, rootId, buyerId, purchaseId, "subtree");
    expect(
      await errorOf(
        asUser(t, "seller").mutation(api.notes.deleteNote, { id: ids[1] }),
      ),
    ).toBe("NOTE_HAS_PURCHASE_GRANTS");
  });

  test("copy-mode sold note can be deleted and listing unpublishes", async () => {
    const { t, rootId, listingId } = await setup();
    await asUser(t, "seller").mutation(api.notes.deleteNote, { id: rootId });
    expect(await t.run(ctx => ctx.db.get("notes", rootId))).toBeNull();
    expect(
      (await t.run(ctx => ctx.db.get("listings", listingId)))?.status,
    ).toBe("unpublished");
  });
});

describe("duplicate", () => {
  test("duplicates a 3-level tree via the shared helper", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, { key: "owner" });
    const { ids } = await seedTree(t, owner, {
      title: "Top",
      children: [
        {
          title: "Mid",
          children: [{ title: "Leaf A" }, { title: "Leaf B" }],
        },
      ],
    });
    // ids[1] has parent ids[0]
    const newId = await asUser(t, "owner").mutation(api.notes.duplicateNote, {
      id: ids[1],
    });
    const copy = await t.run(ctx => ctx.db.get("notes", newId));
    expect(copy?.title).toBe("Mid - Copy");
    expect(copy?.parentNote).toBe(ids[0]);
    expect(copy?.purchaseId).toBeUndefined();
    const parent = await t.run(ctx => ctx.db.get("notes", ids[0]));
    expect(parent?.childNotes).toEqual([ids[1], newId]);
    const kids = await t.run(async ctx =>
      Promise.all((copy?.childNotes ?? []).map(id => ctx.db.get("notes", id))),
    );
    expect(kids.map(k => k?.title)).toEqual(["Leaf A", "Leaf B"]);
    expect(kids.every(k => k?.parentNote === newId)).toBe(true);
  });
});
