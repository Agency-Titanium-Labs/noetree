import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  canCreateUnder,
  canEditNote,
  getUserPermission,
} from "./helpers/permissions";
import { asUser, seedTree, seedUser } from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

describe("canEditNote helper", () => {
  const user1 = "000000000000000000000000000user" as Id<"users">;
  const user2 = "000000000000000000000000001user" as Id<"users">;
  const myNote = { owner: user1 };
  const otherNote = { owner: user2 };

  test("owner, admin, and edit roles are allowed to edit any note", () => {
    expect(canEditNote(myNote, user1, "owner")).toBe(true);
    expect(canEditNote(otherNote, user1, "owner")).toBe(true);

    expect(canEditNote(myNote, user1, "admin")).toBe(true);
    expect(canEditNote(otherNote, user1, "admin")).toBe(true);

    expect(canEditNote(myNote, user1, "edit")).toBe(true);
    expect(canEditNote(otherNote, user1, "edit")).toBe(true);
  });

  test("contributor role is allowed to edit only own notes", () => {
    expect(canEditNote(myNote, user1, "contributor")).toBe(true);
    expect(canEditNote(otherNote, user1, "contributor")).toBe(false);

    // Also supports user object with _id
    expect(canEditNote(myNote, { _id: user1 }, "contributor")).toBe(true);
    expect(canEditNote(otherNote, { _id: user1 }, "contributor")).toBe(false);
  });

  test("view, null, and undefined roles are refused", () => {
    expect(canEditNote(myNote, user1, "view")).toBe(false);
    expect(canEditNote(myNote, user1, null)).toBe(false);
    expect(canEditNote(myNote, user1, undefined)).toBe(false);
  });
});

describe("canCreateUnder helper", () => {
  test("allows owner, admin, edit, and contributor", () => {
    expect(canCreateUnder("owner")).toBe(true);
    expect(canCreateUnder("admin")).toBe(true);
    expect(canCreateUnder("edit")).toBe(true);
    expect(canCreateUnder("contributor")).toBe(true);
  });

  test("disallows view, null, and undefined", () => {
    expect(canCreateUnder("view")).toBe(false);
    expect(canCreateUnder(null)).toBe(false);
    expect(canCreateUnder(undefined)).toBe(false);
  });
});

describe("Contributor role end-to-end integration", () => {
  async function setupContributorScenario() {
    const t = convexTest(schema, modules);
    const ownerId = await seedUser(t, {
      key: "owner_alice",
      email: "alice@test.com",
    });
    const contribId = await seedUser(t, {
      key: "contrib_bob",
      email: "bob@test.com",
    });

    // Alice creates a tree with Root and ChildAlice
    const { rootId, ids } = await seedTree(t, ownerId, {
      title: "Alice Root Note",
      content: "Alice Root Content",
      children: [
        {
          title: "Alice Child Note",
          content: "Alice Child Content",
        },
      ],
    });
    const aliceChildId = ids[1];

    // Alice invites Bob as a contributor on Root Note
    await asUser(t, "owner_alice").mutation(api.notes.inviteUser, {
      noteId: rootId,
      email: "bob@test.com",
      role: "contributor",
    });

    return { t, ownerId, contribId, rootId, aliceChildId };
  }

  test("contributor resolves 'contributor' permission on shared tree notes", async () => {
    const { t, contribId, rootId, aliceChildId } =
      await setupContributorScenario();

    const rootPerm = await t.run(ctx =>
      getUserPermission(ctx, rootId, contribId),
    );
    expect(rootPerm).toBe("contributor");

    const childPerm = await t.run(ctx =>
      getUserPermission(ctx, aliceChildId, contribId),
    );
    expect(childPerm).toBe("contributor");
  });

  test("contributor can create a child note under shared root", async () => {
    const { t, contribId, rootId } = await setupContributorScenario();

    const bobNoteId = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Child Note",
        content: "Bob Content",
        parentNote: rootId,
      },
    );

    expect(bobNoteId).toBeTruthy();

    const bobNoteDoc = await t.run(ctx => ctx.db.get("notes", bobNoteId));
    expect(bobNoteDoc?.owner).toBe(contribId);
    expect(bobNoteDoc?.parentNote).toBe(rootId);

    // Contributor's permission on their own created note in the tree
    const bobNotePerm = await t.run(ctx =>
      getUserPermission(ctx, bobNoteId, contribId),
    );
    expect(bobNotePerm).toBe("contributor");
  });

  test("tree queries report canEdit: true for own note and canEdit: false for others", async () => {
    const { t, rootId, aliceChildId } = await setupContributorScenario();

    const bobNoteId = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Child Note",
        content: "Bob Content",
        parentNote: rootId,
      },
    );

    // Query tree as Bob
    const tree = await asUser(t, "contrib_bob").query(api.notes.getTreeById, {
      id: rootId,
      deep: 2,
    });

    expect(tree).toBeDefined();
    expect(tree?._id).toBe(rootId);
    expect(tree?.role).toBe("contributor");
    expect(tree?.canEdit).toBe(false); // Alice owns root note

    const children = (tree?.childNotes || []) as Array<{
      _id: Id<"notes">;
      role?: string;
      canEdit?: boolean;
    }>;
    const aliceChild = children.find(c => c._id === aliceChildId);
    const bobChild = children.find(c => c._id === bobNoteId);

    expect(aliceChild).toBeDefined();
    expect(aliceChild?.role).toBe("contributor");
    expect(aliceChild?.canEdit).toBe(false);

    expect(bobChild).toBeDefined();
    expect(bobChild?.role).toBe("contributor");
    expect(bobChild?.canEdit).toBe(true); // Bob owns this note!
  });

  test("contributor can update title and content of their own note", async () => {
    const { t, rootId } = await setupContributorScenario();

    const bobNoteId = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Initial Title",
        content: "Bob Initial Content",
        parentNote: rootId,
      },
    );

    // Bob updates title
    await asUser(t, "contrib_bob").mutation(api.notes.updateNoteTitle, {
      id: bobNoteId,
      title: "Bob Updated Title",
    });

    // Bob updates content
    await asUser(t, "contrib_bob").mutation(api.notes.updateNoteContent, {
      id: bobNoteId,
      content: "Bob Updated Content",
    });

    const updated = await t.run(ctx => ctx.db.get("notes", bobNoteId));
    expect(updated?.title).toBe("Bob Updated Title");
    expect(updated?.content).toBe("Bob Updated Content");
  });

  test("contributor receives an error if attempting to modify a third-party note", async () => {
    const { t, rootId, aliceChildId } = await setupContributorScenario();

    // Bob attempts to update Alice's root note title
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.updateNoteTitle, {
        id: rootId,
        title: "Hacked Title",
      }),
    ).rejects.toThrow(/Unauthorized/);

    // Bob attempts to update Alice's root note content
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.updateNoteContent, {
        id: rootId,
        content: "Hacked Content",
      }),
    ).rejects.toThrow(/Unauthorized/);

    // Bob attempts to update Alice's child note title
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.updateNoteTitle, {
        id: aliceChildId,
        title: "Hacked Child Title",
      }),
    ).rejects.toThrow(/Unauthorized/);

    // Bob attempts to update Alice's child note content via updateNote
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.updateNote, {
        id: aliceChildId,
        title: "Hacked Child",
        content: "Hacked",
      }),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("contributor can delete their own note", async () => {
    const { t, rootId } = await setupContributorScenario();

    const bobNoteId = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Temporary Note",
        content: "To be deleted",
        parentNote: rootId,
      },
    );

    await asUser(t, "contrib_bob").mutation(api.notes.deleteNote, {
      id: bobNoteId,
    });

    const doc = await t.run(ctx => ctx.db.get("notes", bobNoteId));
    expect(doc).toBeNull();
  });

  test("contributor receives an error if attempting to delete a third-party note", async () => {
    const { t, rootId, aliceChildId } = await setupContributorScenario();

    // Bob attempts to delete Alice's root note
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.deleteNote, {
        id: rootId,
      }),
    ).rejects.toThrow(/Unauthorized/);

    // Bob attempts to delete Alice's child note
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.deleteNote, {
        id: aliceChildId,
      }),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("contributor can create a sub-note under their own note in the shared tree", async () => {
    const { t, rootId } = await setupContributorScenario();

    const bobNote1 = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Level 1",
        parentNote: rootId,
      },
    );

    const bobNote2 = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Level 2",
        parentNote: bobNote1,
      },
    );

    expect(bobNote2).toBeTruthy();
    const doc = await t.run(ctx => ctx.db.get("notes", bobNote2));
    expect(doc?.parentNote).toBe(bobNote1);
  });

  test("contributor can duplicate their own note, but not a third-party note", async () => {
    const { t, rootId, aliceChildId } = await setupContributorScenario();

    const bobNoteId = await asUser(t, "contrib_bob").mutation(
      api.notes.createNote,
      {
        title: "Bob Duplicate Me",
        parentNote: rootId,
      },
    );

    // Contributor duplicates their own note
    const dupBobNoteId = await asUser(t, "contrib_bob").mutation(
      api.notes.duplicateNote,
      {
        id: bobNoteId,
      },
    );
    expect(dupBobNoteId).toBeTruthy();
    const dupDoc = await t.run(ctx => ctx.db.get("notes", dupBobNoteId));
    expect(dupDoc?.title).toContain("Bob Duplicate Me - Copy");
    expect(dupDoc?.parentNote).toBe(rootId);

    // Contributor attempts to duplicate Alice's child note
    await expect(
      asUser(t, "contrib_bob").mutation(api.notes.duplicateNote, {
        id: aliceChildId,
      }),
    ).rejects.toThrow(/Unauthorized/);
  });
});
