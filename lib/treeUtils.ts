import { Doc, Id } from "@/convex/_generated/dataModel";

export interface NoteTree extends Omit<Doc<"notes">, "childNotes"> {
  childNotes?: NoteTree[];
  shareId?: Id<"shares">;
  isShared?: boolean;
  role?: "owner" | "admin" | "edit" | "view";
}

export interface DashboardTreeItem {
  _id: Id<"notes">;
  _creationTime: number;
  title: string;
  content: string;
  childNotes?: DashboardTreeItem[] | undefined;
  nestedNotesCount?: number;
  index?: number;
  isPinned?: boolean;
  shareId?: Id<"shares">;
  isShared?: boolean;
  role?: "owner" | "admin" | "edit" | "view";
}

/**
 * Appends a temporary child note to a parent node within a NoteTree.
 */
export const addChildNoteToTree = (
  root: NoteTree,
  parentId: Id<"notes">,
  newNoteTitle: string,
  tempId: string,
): NoteTree => {
  const clone = JSON.parse(JSON.stringify(root)) as NoteTree;

  const addChild = (node: NoteTree): boolean => {
    if (node._id === parentId) {
      if (!node.childNotes) node.childNotes = [];
      node.childNotes.push({
        _id: tempId as unknown as Id<"notes">,
        _creationTime: Date.now(),
        title: newNoteTitle,
        content: "",
        parentNote: parentId,
        owner: node.owner,
        childNotes: [],
      });
      return true;
    }
    if (node.childNotes) {
      for (const child of node.childNotes) {
        if (addChild(child)) return true;
      }
    }
    return false;
  };

  addChild(clone);
  return clone;
};

/**
 * Moves a node from one parent to another at a specific index within a NoteTree.
 */
export const moveNoteInTree = (
  root: NoteTree,
  noteId: Id<"notes">,
  fromId: Id<"notes">,
  toId: Id<"notes">,
  index?: number,
): NoteTree => {
  const clone = JSON.parse(JSON.stringify(root)) as NoteTree;

  let movedNode: NoteTree | null = null;
  const removeNode = (node: NoteTree): boolean => {
    if (node.childNotes) {
      const idx = node.childNotes.findIndex(c => c._id === noteId);
      if (idx !== -1) {
        [movedNode] = node.childNotes.splice(idx, 1);
        return true;
      }
      for (const child of node.childNotes) {
        if (removeNode(child)) return true;
      }
    }
    return false;
  };

  const insertNode = (node: NoteTree): boolean => {
    if (node._id === toId) {
      if (!node.childNotes) node.childNotes = [];
      if (movedNode) {
        movedNode.parentNote = toId;
        if (index !== undefined) {
          node.childNotes.splice(index, 0, movedNode);
        } else {
          node.childNotes.push(movedNode);
        }
      }
      return true;
    }
    if (node.childNotes) {
      for (const child of node.childNotes) {
        if (insertNode(child)) return true;
      }
    }
    return false;
  };

  if (clone._id === noteId) {
    movedNode = { ...clone };
  } else {
    removeNode(clone);
  }

  if (movedNode) {
    insertNode(clone);
  }

  return clone;
};

/**
 * Updates the sorted child note IDs list for a parent node within a NoteTree.
 */
export const updateChildOrderInTree = (
  root: NoteTree,
  parentId: Id<"notes">,
  orderedChildIds: Id<"notes">[],
): NoteTree => {
  const clone = JSON.parse(JSON.stringify(root)) as NoteTree;

  const updateOrder = (node: NoteTree): boolean => {
    if (node._id === parentId) {
      if (node.childNotes) {
        const mapped = orderedChildIds
          .map(id => node.childNotes!.find(c => c._id === id))
          .filter((c): c is NoteTree => !!c);
        node.childNotes = mapped;
      }
      return true;
    }
    if (node.childNotes) {
      for (const child of node.childNotes) {
        if (updateOrder(child)) return true;
      }
    }
    return false;
  };

  updateOrder(clone);
  return clone;
};

/**
 * Removes a note from a NoteTree.
 */
export const removeNoteFromTree = (
  root: NoteTree,
  noteId: Id<"notes">,
): NoteTree => {
  const clone = JSON.parse(JSON.stringify(root)) as NoteTree;

  const removeNode = (node: NoteTree): boolean => {
    if (node.childNotes) {
      const idx = node.childNotes.findIndex(c => c._id === noteId);
      if (idx !== -1) {
        node.childNotes.splice(idx, 1);
        return true;
      }
      for (const child of node.childNotes) {
        if (removeNode(child)) return true;
      }
    }
    return false;
  };

  removeNode(clone);
  return clone;
};

/**
 * Renames a note in a NoteTree.
 */
export const updateTitleInTree = (
  root: NoteTree,
  noteId: Id<"notes">,
  newTitle: string,
): NoteTree => {
  const clone = JSON.parse(JSON.stringify(root)) as NoteTree;

  const updateTitle = (node: NoteTree): boolean => {
    if (node._id === noteId) {
      node.title = newTitle;
      return true;
    }
    if (node.childNotes) {
      for (const child of node.childNotes) {
        if (updateTitle(child)) return true;
      }
    }
    return false;
  };

  updateTitle(clone);
  return clone;
};

/**
 * Renames a tree in the dashboard list.
 */
export const renameTreeInList = (
  list: DashboardTreeItem[],
  id: Id<"notes">,
  title: string,
): DashboardTreeItem[] => {
  return list.map(tree => {
    if (tree._id === id) {
      return { ...tree, title };
    }
    return tree;
  });
};

/**
 * Removes a tree from the dashboard list.
 */
export const removeTreeFromList = (
  list: DashboardTreeItem[],
  id: Id<"notes">,
): DashboardTreeItem[] => {
  return list.filter(tree => tree._id !== id);
};

/**
 * Reorders trees in the dashboard list using a fractional index.
 */
export const updateTreeIndexInList = (
  list: DashboardTreeItem[],
  id: Id<"notes">,
  newIndex: number,
): DashboardTreeItem[] => {
  const updated = list.map(tree => {
    if (tree._id === id) {
      return { ...tree, index: newIndex };
    }
    return tree;
  });
  updated.sort((a, b) => {
    const pinA = a.isPinned ? 1 : 0;
    const pinB = b.isPinned ? 1 : 0;
    if (pinA !== pinB) {
      return pinB - pinA;
    }
    const indexA = a.index ?? a._creationTime;
    const indexB = b.index ?? b._creationTime;
    return indexA - indexB;
  });
  return updated;
};

/**
 * Adds a new temporary tree to the dashboard list.
 */
export const addTreeToList = (
  list: DashboardTreeItem[],
  title: string,
  tempId: Id<"notes">,
): DashboardTreeItem[] => {
  const newTree: DashboardTreeItem = {
    _id: tempId,
    _creationTime: Date.now(),
    title,
    content: "{}",
    childNotes: [],
    nestedNotesCount: 0,
  };
  return [...list, newTree];
};

/**
 * Toggles a tree's pinned status in the dashboard list and re-sorts.
 */
export const togglePinTreeInList = (
  list: DashboardTreeItem[],
  id: Id<"notes">,
): DashboardTreeItem[] => {
  const updated = list.map(tree => {
    if (tree._id === id) {
      return { ...tree, isPinned: !tree.isPinned };
    }
    return tree;
  });
  updated.sort((a, b) => {
    const pinA = a.isPinned ? 1 : 0;
    const pinB = b.isPinned ? 1 : 0;
    if (pinA !== pinB) {
      return pinB - pinA;
    }
    const indexA = a.index ?? a._creationTime;
    const indexB = b.index ?? b._creationTime;
    return indexA - indexB;
  });
  return updated;
};
