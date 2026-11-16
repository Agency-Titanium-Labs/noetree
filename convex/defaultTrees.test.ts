import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { asUser, seedTree, seedUser } from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

describe("Default Shared Trees (Admin CLI & Auto-Sharing)", () => {
  async function setupScenario() {
    const t = convexTest(schema, modules);
    const adminId = await seedUser(t, {
      key: "admin_antoine",
      email: "antoine@noetree.com",
    });
    const existingTesterId = await seedUser(t, {
      key: "tester_alice",
      email: "alice@test.com",
    });

    // Admin creates root tree "🚀 Feedbacks Beta" with child notes
    const { rootId, ids } = await seedTree(t, adminId, {
      title: "🚀 Feedbacks Beta",
      content: "Welcome to Feedbacks Beta",
      children: [
        { title: "🐛 Bugs", content: "Bug reports" },
        { title: "💡 Suggestions / Idées", content: "Ideas" },
      ],
    });

    return { t, adminId, existingTesterId, rootId, childId: ids[1] };
  }

  test("setDefaultSharedTree marks the tree and backfills existing users", async () => {
    const { t, adminId, existingTesterId, rootId } = await setupScenario();

    // Call CLI mutation
    const result = await t.mutation(internal.admin.setDefaultSharedTree, {
      noteId: rootId,
    });

    expect(result.success).toBe(true);
    expect(result.isDefaultShared).toBe(true);
    expect(result.usersBackfilled).toBe(1); // Alice was backfilled, not Antoine (owner)

    // Verify root note document has isDefaultShared: true
    const noteDoc = await t.run(ctx => ctx.db.get("notes", rootId));
    expect(noteDoc?.isDefaultShared).toBe(true);

    // Verify Alice has a contributor share
    const aliceShares = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_user_note", q =>
          q.eq("userId", existingTesterId).eq("noteId", rootId),
        )
        .collect(),
    );
    expect(aliceShares).toHaveLength(1);
    expect(aliceShares[0].role).toBe("contributor");

    // Verify Alice sees the tree in getTreesByMe
    const aliceTrees = await asUser(t, "tester_alice").query(
      api.notes.getTreesByMe,
      {},
    );
    expect(aliceTrees.some(tree => tree._id === rootId)).toBe(true);
  });

  test("setDefaultSharedTree can disable default sharing", async () => {
    const { t, rootId } = await setupScenario();

    // Enable
    await t.mutation(internal.admin.setDefaultSharedTree, {
      noteId: rootId,
      enabled: true,
    });

    let doc = await t.run(ctx => ctx.db.get("notes", rootId));
    expect(doc?.isDefaultShared).toBe(true);

    // Disable
    const result = await t.mutation(internal.admin.setDefaultSharedTree, {
      noteId: rootId,
      enabled: false,
    });

    expect(result.success).toBe(true);
    expect(result.isDefaultShared).toBe(false);

    doc = await t.run(ctx => ctx.db.get("notes", rootId));
    expect(doc?.isDefaultShared).toBe(false);
  });

  test("setDefaultSharedTree refuses non-root notes", async () => {
    const { t, childId } = await setupScenario();

    await expect(
      t.mutation(internal.admin.setDefaultSharedTree, {
        noteId: childId,
      }),
    ).rejects.toThrow(/Only a root note/);
  });

  test("new user signing in automatically receives the default shared tree", async () => {
    const { t, rootId } = await setupScenario();

    // Admin sets tree as default shared
    await t.mutation(internal.admin.setDefaultSharedTree, {
      noteId: rootId,
    });

    // A brand new user arrives on noetree.com and logs in
    const newTesterIdentity = {
      tokenIdentifier: "https://clerk.dev|new_tester_bob",
      subject: "new_tester_bob",
      name: "Bob Tester",
      email: "bob@newtester.com",
    };

    const newUserId = await t
      .withIdentity(newTesterIdentity)
      .mutation(api.users.store, {});

    expect(newUserId).toBeTruthy();

    // Verify Bob automatically received the contributor share
    const bobShares = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_user_note", q =>
          q.eq("userId", newUserId).eq("noteId", rootId),
        )
        .collect(),
    );
    expect(bobShares).toHaveLength(1);
    expect(bobShares[0].role).toBe("contributor");

    // Verify Bob can create a bug under the shared tree
    const bobBugId = await t
      .withIdentity(newTesterIdentity)
      .mutation(api.notes.createNote, {
        title: "[Bug] Button not clickable",
        content: "Details of bug",
        parentNote: rootId,
      });

    expect(bobBugId).toBeTruthy();
    const bobBugDoc = await t.run(ctx => ctx.db.get("notes", bobBugId));
    expect(bobBugDoc?.owner).toBe(newUserId);

    // Verify Bob can edit his own bug note
    await t
      .withIdentity(newTesterIdentity)
      .mutation(api.notes.updateNoteTitle, {
        id: bobBugId,
        title: "[Bug] Button fixed",
      });

    const updatedBug = await t.run(ctx => ctx.db.get("notes", bobBugId));
    expect(updatedBug?.title).toBe("[Bug] Button fixed");

    // Verify Bob cannot modify the root note
    await expect(
      t.withIdentity(newTesterIdentity).mutation(api.notes.updateNoteTitle, {
        id: rootId,
        title: "Hacked",
      }),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("user who explicitly leaves the tree is not re-subscribed on next login", async () => {
    const { t, existingTesterId, rootId } = await setupScenario();

    // Activate default tree
    await t.mutation(internal.admin.setDefaultSharedTree, {
      noteId: rootId,
    });

    // Alice gets the share
    const share = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_user_note", q =>
          q.eq("userId", existingTesterId).eq("noteId", rootId),
        )
        .first(),
    );
    expect(share).toBeTruthy();

    // Alice leaves the share
    await asUser(t, "tester_alice").mutation(api.notes.removeShare, {
      shareId: share!._id,
    });

    // Verify share is deleted
    const shareAfter = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_user_note", q =>
          q.eq("userId", existingTesterId).eq("noteId", rootId),
        )
        .first(),
    );
    expect(shareAfter).toBeNull();

    // Alice logs in again (storeUser runs)
    await asUser(t, "tester_alice").mutation(api.users.store, {});

    // Verify share is NOT re-created because she explicitly left
    const shareAfterLogin = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_user_note", q =>
          q.eq("userId", existingTesterId).eq("noteId", rootId),
        )
        .first(),
    );
    expect(shareAfterLogin).toBeNull();
  });

  test("listDefaultSharedTrees returns all active default trees", async () => {
    const { t, rootId, adminId } = await setupScenario();

    await t.mutation(internal.admin.setDefaultSharedTree, {
      noteId: rootId,
    });

    const list = await t.query(internal.admin.listDefaultSharedTrees, {});
    expect(list).toHaveLength(1);
    expect(list[0].noteId).toBe(rootId);
    expect(list[0].title).toBe("🚀 Feedbacks Beta");
    expect(list[0].ownerId).toBe(adminId);
    expect(list[0].shareCount).toBe(1);
  });
});
