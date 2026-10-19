import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  CONTEXT_BUDGET_CHARS,
  CONTEXT_MAX_CHILDREN,
} from "./helpers/aiContext";
import {
  TEST_SECRET,
  USER,
  as,
  balances,
  begin,
  errorCode,
  ledger,
  runs,
  seedCredits,
} from "../test-utils/aiHarness";
import { seedListing, seedTree, seedUser } from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

beforeEach(() => {
  process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
});
afterEach(() => {
  delete process.env.INTERNAL_WEBHOOK_SECRET;
});

function doc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function beginWithNote(
  t: ReturnType<typeof convexTest>,
  requestId: string,
  noteId: Id<"notes">,
  actionKey = "basic",
) {
  return await as(t).mutation(api.aiRuns.beginRun, {
    requestId,
    actionKey,
    noteId,
  });
}

async function rejects(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return errorCode(err);
  }
  throw new Error("expected rejection");
}

async function untouched(t: ReturnType<typeof convexTest>, total: number) {
  expect((await balances(t)).total).toBe(total);
  expect(await runs(t)).toHaveLength(0);
  expect(await ledger(t)).toHaveLength(0);
  const limits = await t.run(async ctx =>
    ctx.db.query("aiRateLimits").collect(),
  );
  expect(limits).toHaveLength(0);
}

describe("beginRun with note context (CTX-01..CTX-05)", () => {
  it("returns the assembled context and still reserves exactly once", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 10 });
    const { rootId, ids } = await seedTree(t, me, {
      title: "Root",
      content: doc("root text"),
      children: [
        {
          title: "Cur",
          content: doc("current text"),
          children: [
            { title: "Kid A", content: doc("kid a") },
            { title: "Kid B", content: doc("kid b") },
          ],
        },
      ],
    });
    const cur = ids[1];

    const res = await beginWithNote(t, "ctx-ok-1", cur);
    expect(res.claimed).toBe(true);
    expect(res.context).toBeDefined();
    const ctxOut = res.context!;
    expect(ctxOut.included.map(i => [i.role, i.title])).toEqual([
      ["current", "Cur"],
      ["ancestor", "Root"],
      ["child", "Kid A"],
      ["child", "Kid B"],
    ]);
    expect(ctxOut.serialized).toContain("current text");
    expect(ctxOut.serialized).toContain("root text");
    expect(ctxOut.totalChars).toBeLessThanOrEqual(CONTEXT_BUDGET_CHARS);
    expect(rootId).toBeDefined();

    expect((await balances(t)).total).toBe(9);
    expect(await runs(t)).toHaveLength(1);
  });

  it("without noteId behaves as before (no context key)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 5 });
    const res = await begin(t, "ctx-none-1");
    expect(res.context).toBeUndefined();
    expect((await balances(t)).total).toBe(4);
  });

  it("a replay does not rebuild or return the context", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 5 });
    const { rootId } = await seedTree(t, me, { content: doc("hello") });
    await beginWithNote(t, "ctx-replay-1", rootId);
    const again = await beginWithNote(t, "ctx-replay-1", rootId);
    expect(again.replayed).toBe(true);
    expect(again.context).toBeUndefined();
    expect((await balances(t)).total).toBe(4);
    expect(await runs(t)).toHaveLength(1);
  });

  it("CONTEXT_TOO_LARGE: no debit, no aiRuns row, no ledger row, no rate token", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, me, {
      content: doc("w".repeat(CONTEXT_BUDGET_CHARS + 1)),
    });
    expect(await rejects(beginWithNote(t, "ctx-big-1", rootId))).toBe(
      "CONTEXT_TOO_LARGE",
    );
    await untouched(t, 10);
  });

  it("CONTEXT_TOO_LARGE is raised for every paid tier of action, before the debit", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, me, {
      content: doc("w".repeat(CONTEXT_BUDGET_CHARS + 1)),
    });
    expect(
      await rejects(beginWithNote(t, "ctx-big-2", rootId, "semantic")),
    ).toBe("CONTEXT_TOO_LARGE");
    await untouched(t, 10);
  });

  it("a note shared to me but owned by someone else is refused, no debit", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, { key: USER });
    const other = await seedUser(t, { key: "user_other" });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, other, { content: doc("theirs") });
    await t.run(async ctx => {
      const me = await ctx.db
        .query("users")
        .withIndex("by_token", q =>
          q.eq("tokenIdentifier", `https://clerk.dev|${USER}`),
        )
        .unique();
      await ctx.db.insert("shares", {
        noteId: rootId,
        userId: me!._id,
        email: "me@example.com",
        role: "edit",
      });
    });
    expect(await rejects(beginWithNote(t, "ctx-share-1", rootId))).toBe(
      "NOTE_NOT_OWNED",
    );
    await untouched(t, 10);
  });

  it("a public note of someone else is refused too", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, { key: USER });
    const other = await seedUser(t, { key: "user_other" });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, other, { content: doc("public") });
    await t.run(ctx => ctx.db.patch("notes", rootId, { isPublic: true }));
    expect(await rejects(beginWithNote(t, "ctx-pub-1", rootId))).toBe(
      "NOTE_NOT_OWNED",
    );
    await untouched(t, 10);
  });

  it("an unknown identity (no users row) is refused, no debit", async () => {
    const t = convexTest(schema, modules);
    const other = await seedUser(t, { key: "user_other" });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, other, { content: doc("x") });
    expect(await rejects(beginWithNote(t, "ctx-nouser-1", rootId))).toBe(
      "NOTE_NOT_FOUND",
    );
    await untouched(t, 10);
  });

  it("a deleted note is NOTE_NOT_FOUND, no debit", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, me, { content: doc("x") });
    await t.run(ctx => ctx.db.delete("notes", rootId));
    expect(await rejects(beginWithNote(t, "ctx-del-1", rootId))).toBe(
      "NOTE_NOT_FOUND",
    );
    await untouched(t, 10);
  });

  it("a purchased copy root and its edited sub-notes are refused, no debit", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    const seller = await seedUser(t, { key: "user_seller" });
    await seedCredits(t, { monthly: 10 });

    const origin = await seedTree(t, seller, { content: doc("seller") });
    const listingId = await seedListing(t, {
      noteId: origin.rootId,
      sellerId: seller,
      sellerKey: "user_seller",
    });
    const copy = await seedTree(t, me, {
      title: "Bought",
      content: doc("purchased"),
      children: [{ title: "Sub", content: doc("buyer edited") }],
    });
    await t.run(async ctx => {
      const purchaseId = await ctx.db.insert("purchases", {
        buyerId: me,
        buyerClerkUserId: USER,
        listingId,
        noteId: origin.rootId,
        sellerId: seller,
        sellerClerkUserId: "user_seller",
        status: "paid",
        title: "Pack",
        priceCents: 1000,
        currency: "eur",
        sellerTier: "free",
        commissionRateBps: 1500,
        commissionCents: 150,
        sellerNetCents: 850,
        scope: "subtree",
        accessMode: "copy",
        noteCount: 2,
        destinationAccountId: "acct_x",
        snapshotVersion: 1,
        snapshotAt: 1,
        deliveredNoteId: copy.rootId,
        deliveryStatus: "delivered",
      });
      await ctx.db.patch("notes", copy.rootId, { purchaseId });
    });

    expect(await rejects(beginWithNote(t, "ctx-buy-1", copy.rootId))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
    expect(await rejects(beginWithNote(t, "ctx-buy-2", copy.ids[1]))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
    await untouched(t, 10);
  });

  it("excludes a foreign child and includes own listed note", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    const other = await seedUser(t, { key: "user_other" });
    await seedCredits(t, { monthly: 10 });
    const tree = await seedTree(t, me, {
      title: "Parent",
      content: doc("parent"),
      children: [
        { title: "Mine listed", content: doc("mine listed") },
        { title: "Foreign", content: doc("foreign body") },
      ],
    });
    const [parent, listed, foreign] = tree.ids;
    // A note someone else owns sitting under my note (e.g. moved/legacy).
    await t.run(ctx => ctx.db.patch("notes", foreign, { owner: other }));
    const origin = await seedTree(t, other, { content: doc("o") });
    const listing = await seedListing(t, {
      noteId: listed,
      sellerId: me,
      sellerKey: USER,
    });
    expect(listing).toBeDefined();
    expect(origin.rootId).toBeDefined();

    const res = await beginWithNote(t, "ctx-mix-1", parent);
    const titles = res.context!.included.map(i => i.title);
    expect(titles).toEqual(["Parent", "Mine listed"]);
    expect(res.context!.dropped).toContainEqual({
      noteId: foreign,
      role: "child",
      reason: "not_owned",
    });
    expect(res.context!.serialized).not.toContain("foreign body");
  });

  it("caps children at the limit through the real loader", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 10 });
    const { rootId } = await seedTree(t, me, {
      title: "Parent",
      children: Array.from({ length: CONTEXT_MAX_CHILDREN + 5 }, (_, i) => ({
        title: `Kid ${i}`,
        content: doc(`kid ${i}`),
      })),
    });
    const res = await beginWithNote(t, "ctx-cap-1", rootId);
    const kids = res.context!.included.filter(i => i.role === "child");
    expect(kids).toHaveLength(CONTEXT_MAX_CHILDREN);
    expect(kids[0].title).toBe("Kid 0");
    expect(
      res.context!.dropped.filter(d => d.reason === "child_cap"),
    ).toHaveLength(5);
  });

  it("survives a dangling child id and a deleted parent", async () => {
    const t = convexTest(schema, modules);
    const me = await seedUser(t, { key: USER });
    await seedCredits(t, { monthly: 10 });
    const { ids } = await seedTree(t, me, {
      title: "Parent",
      children: [{ title: "Gone" }, { title: "Kept", content: doc("kept") }],
    });
    const [parent, gone] = ids;
    await t.run(ctx => ctx.db.delete("notes", gone));
    const res = await beginWithNote(t, "ctx-dang-1", parent);
    expect(res.context!.included.map(i => i.title)).toEqual(["Parent", "Kept"]);
    expect(res.context!.dropped).toContainEqual({
      noteId: gone,
      role: "child",
      reason: "missing",
    });
  });
});
