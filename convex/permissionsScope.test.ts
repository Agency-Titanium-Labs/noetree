import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  getInheritedPermission,
  getUserPermission,
} from "./helpers/permissions";
import {
  asUser,
  preparePendingPurchase,
  seedListing,
  seedTree,
  seedUser,
} from "../test-utils/convexSeed";
import { api } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

async function setup() {
  const t = convexTest(schema, modules);
  const sellerId = await seedUser(t, { key: "seller", connect: true });
  const buyerId = await seedUser(t, { key: "buyer", email: "Buyer@X.com" });
  const { rootId, ids } = await seedTree(t, sellerId, {
    title: "Root",
    content: "ROOT_SECRET",
    children: [
      {
        title: "ChildA",
        content: "CHILD_A_SECRET",
        children: [{ title: "Grand", content: "GRAND_SECRET" }],
      },
      { title: "ChildB", content: "CHILD_B_SECRET" },
    ],
  });
  const listingId = await seedListing(t, {
    noteId: rootId,
    sellerId,
    sellerKey: "seller",
  });
  const purchaseId = await preparePendingPurchase(t, "buyer", listingId);
  return { t, sellerId, buyerId, rootId, ids, purchaseId };
}

type SetupT = Awaited<ReturnType<typeof setup>>["t"];

async function addShare(
  t: SetupT,
  noteId: Id<"notes">,
  userId: Id<"users"> | undefined,
  opts: {
    role?: "view" | "edit" | "admin";
    scope?: "note" | "subtree";
    purchaseId?: Id<"purchases">;
    email?: string;
  } = {},
) {
  return await t.run(ctx =>
    ctx.db.insert("shares", {
      noteId,
      ...(userId ? { userId } : {}),
      email: opts.email ?? "buyer@x.com",
      role: opts.role ?? "view",
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.purchaseId ? { purchaseId: opts.purchaseId } : {}),
    }),
  );
}

const perm = (t: SetupT, n: Id<"notes">, u: Id<"users">) =>
  t.run(ctx => getUserPermission(ctx, n, u));
const inherited = (t: SetupT, n: Id<"notes">, u: Id<"users">) =>
  t.run(ctx => getInheritedPermission(ctx, n, u));

describe("note scope isolation", () => {
  test("note-scope purchase share grants only the note itself", async () => {
    const { t, buyerId, rootId, ids, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { scope: "note", purchaseId });
    expect(await perm(t, rootId, buyerId)).toBe("view");
    expect(await perm(t, ids[1], buyerId)).toBeNull();
    expect(await perm(t, ids[2], buyerId)).toBeNull();
    expect(await inherited(t, rootId, buyerId)).toBeNull();
  });

  test("tree queries never leak children of a note-scope share", async () => {
    const { t, buyerId, rootId, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { scope: "note", purchaseId });
    const trees = await asUser(t, "buyer").query(api.notes.getTreesByMe, {
      deep: 3,
    });
    const root = trees.find(n => n._id === rootId);
    expect(root).toBeDefined();
    expect(root!.childNotes).toEqual([]);
    expect(root!.nestedNotesCount).toBe(0);
    expect(root!.isShared).toBe(true);
    const json = JSON.stringify(trees);
    for (const s of ["CHILD_A_SECRET", "CHILD_B_SECRET", "GRAND_SECRET"]) {
      expect(json).not.toContain(s);
    }
    expect(json).not.toContain("ChildA");

    const one = await asUser(t, "buyer").query(api.notes.getTreeById, {
      id: rootId,
      deep: 3,
    });
    expect(one!.childNotes).toEqual([]);
    const oneJson = JSON.stringify(one);
    expect(oneJson).not.toContain("CHILD_A_SECRET");
    expect(oneJson).not.toContain("ChildB");
  });
});

describe("subtree live", () => {
  test("subtree share resolves descendants, including later-added ones", async () => {
    const { t, sellerId, buyerId, rootId, ids, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { scope: "subtree", purchaseId });
    expect(await perm(t, ids[1], buyerId)).toBe("view");
    expect(await perm(t, ids[2], buyerId)).toBe("view");
    expect(await inherited(t, rootId, buyerId)).toBe("view");
    const later = await t.run(ctx =>
      ctx.db.insert("notes", {
        owner: sellerId,
        title: "Later",
        content: "{}",
        parentNote: rootId,
      }),
    );
    expect(await perm(t, later, buyerId)).toBe("view");
  });

  test("tree queries nest children and flag isPurchased", async () => {
    const { t, buyerId, rootId, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { scope: "subtree", purchaseId });
    const trees = await asUser(t, "buyer").query(api.notes.getTreesByMe, {
      deep: 3,
    });
    const root = trees.find(n => n._id === rootId)!;
    expect(root.isShared).toBe(true);
    expect(root.isPurchased).toBe(true);
    expect(root.nestedNotesCount).toBe(3);
    const kids = root.childNotes as {
      isPurchased?: boolean;
      isShared?: boolean;
    }[];
    expect(kids).toHaveLength(2);
    for (const k of kids) {
      expect(k.isPurchased).toBe(true);
      expect(k.isShared).toBe(true);
    }
    const one = await asUser(t, "buyer").query(api.notes.getTreeById, {
      id: rootId,
      deep: 2,
    });
    expect(one!.isPurchased).toBe(true);
    expect(one!.childNotes).toHaveLength(2);
  });
});

describe("legacy share", () => {
  test("share without scope stays descendant-wide", async () => {
    const { t, buyerId, rootId, ids } = await setup();
    await addShare(t, rootId, buyerId, { role: "edit" });
    expect(await perm(t, ids[1], buyerId)).toBe("edit");
    expect(await perm(t, ids[2], buyerId)).toBe("edit");
  });

  test("email-only share still resolves (lowercased)", async () => {
    const { t, buyerId, rootId, ids } = await setup();
    await addShare(t, rootId, undefined, {
      role: "view",
      email: "buyer@x.com",
    });
    expect(await perm(t, rootId, buyerId)).toBe("view");
    expect(await perm(t, ids[1], buyerId)).toBe("view");
  });

  test("legacy tree output keeps children and no isPurchased", async () => {
    const { t, buyerId, rootId } = await setup();
    await addShare(t, rootId, buyerId, { role: "edit" });
    const trees = await asUser(t, "buyer").query(api.notes.getTreesByMe, {
      deep: 3,
    });
    const root = trees.find(n => n._id === rootId)!;
    expect(root.childNotes).toHaveLength(2);
    expect(root.isPurchased).toBeFalsy();
    expect(root.nestedNotesCount).toBe(3);
  });

  test("owner and ancestor owner resolve owner", async () => {
    const { t, sellerId, rootId, ids } = await setup();
    expect(await perm(t, rootId, sellerId)).toBe("owner");
    expect(await perm(t, ids[2], sellerId)).toBe("owner");
  });
});

describe("best role", () => {
  test("manual edit + purchase view on one note: edit wins in either order", async () => {
    for (const manualFirst of [true, false]) {
      const { t, buyerId, rootId, ids, purchaseId } = await setup();
      const manual = () => addShare(t, rootId, buyerId, { role: "edit" });
      const purchase = () =>
        addShare(t, rootId, buyerId, { scope: "note", purchaseId });
      if (manualFirst) {
        await manual();
        await purchase();
      } else {
        await purchase();
        await manual();
      }
      expect(await perm(t, rootId, buyerId)).toBe("edit");
      expect(await perm(t, ids[1], buyerId)).toBe("edit");
    }
  });

  test("nearest note with an applicable share wins", async () => {
    const { t, buyerId, rootId, ids, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { role: "edit" });
    await addShare(t, ids[1], buyerId, { scope: "note", purchaseId });
    expect(await perm(t, ids[1], buyerId)).toBe("view");
    expect(await perm(t, ids[2], buyerId)).toBe("edit");
  });
});

describe("seller share badge", () => {
  test("purchase shares do not make the seller note look shared", async () => {
    const { t, buyerId, rootId, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { scope: "note", purchaseId });
    let trees = await asUser(t, "seller").query(api.notes.getTreesByMe, {});
    expect(trees.find(n => n._id === rootId)!.isShared).toBe(false);
    await addShare(t, rootId, buyerId, { role: "view", email: "m@x.com" });
    trees = await asUser(t, "seller").query(api.notes.getTreesByMe, {});
    expect(trees.find(n => n._id === rootId)!.isShared).toBe(true);
  });

  test("buyer sees purchased root as shared root (D-19)", async () => {
    const { t, buyerId, rootId, purchaseId } = await setup();
    await addShare(t, rootId, buyerId, { scope: "note", purchaseId });
    const trees = await asUser(t, "buyer").query(api.notes.getTreesByMe, {});
    const root = trees.find(n => n._id === rootId)!;
    expect(root.isShared).toBe(true);
    expect(root.isPurchased).toBe(true);
  });
});
