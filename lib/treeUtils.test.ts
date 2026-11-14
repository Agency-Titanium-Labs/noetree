import { describe, expect, test } from "vitest";
import {
  moveNoteInTree,
  updateChildOrderInTree,
  findNoteInTree,
  isNodeInSubtree,
  NoteTree,
} from "./treeUtils";
import { Id } from "@/convex/_generated/dataModel";

const id = (val: string) => val as Id<"notes">;

const createSampleTree = (): NoteTree => {
  return {
    _id: id("root"),
    _creationTime: 1000,
    owner: id("user1") as unknown as Id<"users">,
    title: "Root",
    content: "{}",
    childNotes: [
      {
        _id: id("child-A"),
        _creationTime: 1001,
        owner: id("user1") as unknown as Id<"users">,
        title: "Child A",
        content: "{}",
        parentNote: id("root"),
        childNotes: [
          {
            _id: id("grandchild-A1"),
            _creationTime: 1002,
            owner: id("user1") as unknown as Id<"users">,
            title: "Grandchild A1",
            content: "{}",
            parentNote: id("child-A"),
            childNotes: [],
          },
        ],
      },
      {
        _id: id("child-B"),
        _creationTime: 1003,
        owner: id("user1") as unknown as Id<"users">,
        title: "Child B",
        content: "{}",
        parentNote: id("root"),
        childNotes: [],
      },
    ],
  };
};

describe("treeUtils - Zero-Note-Loss Integrity Safeguards", () => {
  test("findNoteInTree finds existing notes and returns null for missing", () => {
    const tree = createSampleTree();
    expect(findNoteInTree(tree, id("root"))?._id).toBe("root");
    expect(findNoteInTree(tree, id("child-A"))?._id).toBe("child-A");
    expect(findNoteInTree(tree, id("grandchild-A1"))?._id).toBe(
      "grandchild-A1",
    );
    expect(findNoteInTree(tree, id("non-existent"))).toBeNull();
  });

  test("isNodeInSubtree detects self and descendant relationships", () => {
    const tree = createSampleTree();
    const childA = findNoteInTree(tree, id("child-A"))!;
    expect(isNodeInSubtree(childA, id("child-A"))).toBe(true);
    expect(isNodeInSubtree(childA, id("grandchild-A1"))).toBe(true);
    expect(isNodeInSubtree(childA, id("child-B"))).toBe(false);
    expect(isNodeInSubtree(childA, id("root"))).toBe(false);
  });

  test("CRITICAL: moveNoteInTree NEVER drops a note when moved into itself", () => {
    const tree = createSampleTree();
    // Attempting to move child-A into child-A
    const result = moveNoteInTree(
      tree,
      id("child-A"),
      id("root"),
      id("child-A"),
    );

    // Tree must remain intact, child-A must NOT be lost!
    expect(findNoteInTree(result, id("child-A"))).not.toBeNull();
    expect(findNoteInTree(result, id("grandchild-A1"))).not.toBeNull();
    expect(result.childNotes?.length).toBe(2);
  });

  test("CRITICAL: moveNoteInTree NEVER drops a note when moved into its own descendant", () => {
    const tree = createSampleTree();
    // Attempting to move child-A into its child grandchild-A1
    const result = moveNoteInTree(
      tree,
      id("child-A"),
      id("root"),
      id("grandchild-A1"),
    );

    // Must be rejected and original tree returned intact
    expect(findNoteInTree(result, id("child-A"))).not.toBeNull();
    expect(findNoteInTree(result, id("grandchild-A1"))).not.toBeNull();
    expect(result.childNotes?.length).toBe(2);
  });

  test("CRITICAL: moveNoteInTree NEVER drops a note when target does not exist", () => {
    const tree = createSampleTree();
    const result = moveNoteInTree(
      tree,
      id("child-A"),
      id("root"),
      id("does-not-exist"),
    );

    expect(findNoteInTree(result, id("child-A"))).not.toBeNull();
    expect(findNoteInTree(result, id("grandchild-A1"))).not.toBeNull();
    expect(result.childNotes?.length).toBe(2);
  });

  test("CRITICAL: moveNoteInTree cannot move the root note", () => {
    const tree = createSampleTree();
    const result = moveNoteInTree(tree, id("root"), id("none"), id("child-B"));

    expect(result._id).toBe("root");
    expect(result.childNotes?.length).toBe(2);
  });

  test("Valid move from one parent to another works correctly", () => {
    const tree = createSampleTree();
    // Move grandchild-A1 from child-A to child-B
    const result = moveNoteInTree(
      tree,
      id("grandchild-A1"),
      id("child-A"),
      id("child-B"),
      0,
    );

    const childA = findNoteInTree(result, id("child-A"))!;
    const childB = findNoteInTree(result, id("child-B"))!;

    expect(childA.childNotes?.length).toBe(0);
    expect(childB.childNotes?.length).toBe(1);
    expect(childB.childNotes?.[0]._id).toBe("grandchild-A1");
    expect(childB.childNotes?.[0].parentNote).toBe("child-B");
  });

  test("updateChildOrderInTree NEVER drops unmentioned children", () => {
    const tree = createSampleTree();
    // Passing only grandchild-A1, but child-A has other properties
    const result = updateChildOrderInTree(tree, id("root"), [id("child-B")]);

    const rootChildren = result.childNotes!;
    // Both child-B and child-A must exist! child-A must not have disappeared!
    expect(rootChildren.length).toBe(2);
    expect(rootChildren[0]._id).toBe("child-B");
    expect(rootChildren[1]._id).toBe("child-A");
  });
});
