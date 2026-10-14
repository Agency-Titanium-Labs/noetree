import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Asserts the rejection is a ConvexError carrying NOTE_LIMIT_REACHED as its
// `.data` payload — not just a message-string match. A bare `Error` would
// also satisfy `.rejects.toThrow("NOTE_LIMIT_REACHED")`, which is exactly
// the redaction bug this phase's gap-closure fix corrected (a plain Error's
// message gets redacted crossing the real client/server boundary; only
// ConvexError.data survives it).
async function expectNoteLimitRejection(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow(ConvexError);
  try {
    await promise;
    expect.unreachable("expected promise to reject");
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe("NOTE_LIMIT_REACHED");
  }
}

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

// Seeds a `roles` row + a `users` row (identified by `tokenIdentifier`) and
// `count` `notes` rows owned by that user. Returns the seeded user's _id.
async function seedUserWithNotes(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  count: number,
): Promise<Id<"users">> {
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      tokenIdentifier,
      role: roleId,
    });
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("notes", {
        owner: userId,
        title: `note-${i}`,
        content: "{}",
      });
    }
    return userId;
  });
}

describe("notes.createNote — Free-tier 20-note limit (NOTE_LIMIT_REACHED)", () => {
  test("SC1: a Free user who already owns 20 notes is rejected on the 21st createNote", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_free", 20);

    await expectNoteLimitRejection(
      t
        .withIdentity({
          tokenIdentifier: "https://clerk.dev|user_free",
          subject: "user_free",
        })
        .mutation(api.notes.createNote, { title: "n21" }),
    );
  });

  test("a Free user who owns 19 notes can create the 20th note", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_free19", 19);

    const noteId = await t
      .withIdentity({
        tokenIdentifier: "https://clerk.dev|user_free19",
        subject: "user_free19",
      })
      .mutation(api.notes.createNote, { title: "n20" });

    expect(noteId).toBeTruthy();
  });

  test("SC3: a user with NO subscriptions row is treated as Free — 21st note is rejected", async () => {
    const t = convexTest(schema, modules);
    // No subscriptions row is seeded at all for this user.
    await seedUserWithNotes(t, "https://clerk.dev|user_norow", 20);

    await expectNoteLimitRejection(
      t
        .withIdentity({
          tokenIdentifier: "https://clerk.dev|user_norow",
          subject: "user_norow",
        })
        .mutation(api.notes.createNote, { title: "n21" }),
    );
  });

  test("SC2: a Pro user (active subscription) creates note 21 and note 50 with no rejection", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_pro", 20);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_pro",
        stripeCustomerId: "cus_pro",
        stripeSubscriptionId: "sub_pro",
        status: "active",
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: false,
      });
    });

    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_pro",
      subject: "user_pro",
    });

    const note21 = await identity.mutation(api.notes.createNote, {
      title: "n21",
    });
    expect(note21).toBeTruthy();

    // Insert notes 22-49 directly so we can exercise note 50 without
    // 30 extra round-trips through the mutation.
    await t.run(async ctx => {
      const user = await ctx.db
        .query("users")
        .filter(q =>
          q.eq(q.field("tokenIdentifier"), "https://clerk.dev|user_pro"),
        )
        .first();
      for (let i = 22; i <= 49; i++) {
        await ctx.db.insert("notes", {
          owner: user!._id,
          title: `note-${i}`,
          content: "{}",
        });
      }
    });

    const note50 = await identity.mutation(api.notes.createNote, {
      title: "n50",
    });
    expect(note50).toBeTruthy();
  });

  test("a Free user with a past_due subscription is treated as Free — 21st note is rejected", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_pastdue", 20);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_pastdue",
        stripeCustomerId: "cus_pastdue",
        stripeSubscriptionId: "sub_pastdue",
        status: "past_due",
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: false,
      });
    });

    await expectNoteLimitRejection(
      t
        .withIdentity({
          tokenIdentifier: "https://clerk.dev|user_pastdue",
          subject: "user_pastdue",
        })
        .mutation(api.notes.createNote, { title: "n21" }),
    );
  });

  test("a Free user with a canceled subscription is treated as Free — 21st note is rejected", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_canceled", 20);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_canceled",
        stripeCustomerId: "cus_canceled",
        stripeSubscriptionId: "sub_canceled",
        status: "canceled",
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: false,
      });
    });

    await expectNoteLimitRejection(
      t
        .withIdentity({
          tokenIdentifier: "https://clerk.dev|user_canceled",
          subject: "user_canceled",
        })
        .mutation(api.notes.createNote, { title: "n21" }),
    );
  });
});

describe("notes.moveNote & Tree Hierarchy Integrity Safeguards", () => {
  async function seedTree(
    t: ReturnType<typeof convexTest>,
    tokenIdentifier: string,
  ) {
    return await t.run(async ctx => {
      const roleId = await ctx.db.insert("roles", { role: "user" });
      const userId = await ctx.db.insert("users", {
        tokenIdentifier,
        role: roleId,
      });

      const rootId = await ctx.db.insert("notes", {
        owner: userId,
        title: "Root",
        content: "{}",
      });

      const childAId = await ctx.db.insert("notes", {
        owner: userId,
        title: "Child A",
        content: "{}",
        parentNote: rootId,
      });

      const grandchildAId = await ctx.db.insert("notes", {
        owner: userId,
        title: "Grandchild A1",
        content: "{}",
        parentNote: childAId,
      });

      const childBId = await ctx.db.insert("notes", {
        owner: userId,
        title: "Child B",
        content: "{}",
        parentNote: rootId,
      });

      await ctx.db.patch(rootId, { childNotes: [childAId, childBId] });
      await ctx.db.patch(childAId, { childNotes: [grandchildAId] });

      return { userId, rootId, childAId, grandchildAId, childBId };
    });
  }

  test("CRITICAL: moveNote rejects moving a note into itself", async () => {
    const t = convexTest(schema, modules);
    const { childAId, rootId } = await seedTree(
      t,
      "https://clerk.dev|user_move",
    );

    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_move",
      subject: "user_move",
    });

    await expect(
      identity.mutation(api.notes.moveNote, {
        id: childAId,
        from: rootId,
        to: childAId,
      }),
    ).rejects.toThrow(/Cannot move a note into itself/);
  });

  test("CRITICAL: moveNote rejects moving a note into its own descendant", async () => {
    const t = convexTest(schema, modules);
    const { childAId, grandchildAId, rootId } = await seedTree(
      t,
      "https://clerk.dev|user_move_desc",
    );

    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_move_desc",
      subject: "user_move_desc",
    });

    await expect(
      identity.mutation(api.notes.moveNote, {
        id: childAId,
        from: rootId,
        to: grandchildAId,
      }),
    ).rejects.toThrow(/Cannot move a note into its own descendant/);
  });

  test("CRITICAL: moveNote rejects moving a root note", async () => {
    const t = convexTest(schema, modules);
    const { rootId, childBId } = await seedTree(
      t,
      "https://clerk.dev|user_move_root",
    );

    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_move_root",
      subject: "user_move_root",
    });

    await expect(
      identity.mutation(api.notes.moveNote, {
        id: rootId,
        from: rootId,
        to: childBId,
      }),
    ).rejects.toThrow(/Root note cannot be moved/);
  });

  test("Valid move moves note properly without loss", async () => {
    const t = convexTest(schema, modules);
    const { childAId, grandchildAId, childBId } = await seedTree(
      t,
      "https://clerk.dev|user_valid_move",
    );

    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_valid_move",
      subject: "user_valid_move",
    });

    await identity.mutation(api.notes.moveNote, {
      id: grandchildAId,
      from: childAId,
      to: childBId,
    });

    await t.run(async ctx => {
      const movedNote = await ctx.db.get(grandchildAId);
      const fromParent = await ctx.db.get(childAId);
      const toParent = await ctx.db.get(childBId);

      expect(movedNote?.parentNote).toBe(childBId);
      expect(fromParent?.childNotes).not.toContain(grandchildAId);
      expect(toParent?.childNotes).toContain(grandchildAId);
    });
  });

  test("repairNoteHierarchy automatically breaks cycles and restores orphaned notes", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedTree(t, "https://clerk.dev|user_repair");

    // Manually create a self-loop note like the bug caused
    const corruptedId = await t.run(async ctx => {
      const corruptNote = await ctx.db.insert("notes", {
        owner: userId,
        title: "Disappeared note",
        content: "{}",
      });
      await ctx.db.patch(corruptNote, {
        parentNote: corruptNote,
        childNotes: [corruptNote],
      });
      return corruptNote;
    });

    // Run repair
    const repairResult = await t.mutation(api.notes.repairNoteHierarchy, {});
    expect(repairResult.repairedCount).toBeGreaterThanOrEqual(1);

    // Verify corrupt note is healed to a root note
    await t.run(async ctx => {
      const healedNote = await ctx.db.get(corruptedId);
      expect(healedNote?.parentNote).toBeUndefined();
      expect(healedNote?.childNotes).not.toContain(corruptedId);
    });
  });

  test("Cycle in DB does not cause infinite recursion in getNoteShares", async () => {
    const t = convexTest(schema, modules);
    await seedTree(t, "https://clerk.dev|user_cycle_shares");

    // Create cyclic notes A -> B -> A owned by another user
    const cyclicNoteA = await t.run(async ctx => {
      const otherRoleId = await ctx.db.insert("roles", { role: "user" });
      const otherUser = await ctx.db.insert("users", {
        tokenIdentifier: "https://clerk.dev|other_user",
        role: otherRoleId,
      });

      const noteA = await ctx.db.insert("notes", {
        owner: otherUser,
        title: "A",
        content: "{}",
      });
      const noteB = await ctx.db.insert("notes", {
        owner: otherUser,
        title: "B",
        content: "{}",
        parentNote: noteA,
      });
      await ctx.db.patch(noteA, { parentNote: noteB });
      return noteA;
    });

    // Call getNoteShares as current user on cyclic note
    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_cycle_shares",
      subject: "user_cycle_shares",
    });

    // It should reject with Unauthorized without infinite recursion/stack overflow!
    await expect(
      identity.query(api.notes.getNoteShares, { noteId: cyclicNoteA }),
    ).rejects.toThrow(/Unauthorized/);
  });
});
