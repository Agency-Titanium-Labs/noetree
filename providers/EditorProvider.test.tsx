// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const doc = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

const h = vi.hoisted(() => {
  const fake = {
    isDestroyed: false,
    isEditable: true,
    current: { type: "doc", content: [] } as unknown,
    listener: null as null | ((arg: { editor: unknown }) => void),
    setEditable: vi.fn(),
    setContent: vi.fn(),
    getJSON: vi.fn(),
    getText: vi.fn(() => ""),
    on: vi.fn(),
    off: vi.fn(),
    commands: { setContent: vi.fn() },
    state: {
      tr: { setMeta: vi.fn(() => ({})), selection: { from: 0, to: 0 } },
      selection: { from: 0, to: 0 },
    },
    view: { dispatch: vi.fn() },
  };
  return {
    fake,
    tree: {
      rootNoteId: "tree_root_123" as string | null,
      selectedNote: null as null | Record<string, unknown>,
      onUpdateNoteContent: vi.fn(),
    },
    presenceList: [] as unknown[],
    usePresenceRoomId: null as string | null,
    debounced: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  };
});

vi.mock("@tiptap/react", () => ({
  useEditor: () => h.fake,
}));
vi.mock("@tiptap/core", () => ({}));
vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-placeholder", () => ({
  default: { configure: () => ({}) },
}));
vi.mock("@tiptap/extension-link", () => ({ default: {} }));
vi.mock("@tiptap/extension-image", () => ({ default: {} }));
// Phase 21: the ghost-text extension and its Convex bridge have their own tests.
vi.mock("@/lib/editor/ghostText", () => ({
  GhostText: { configure: () => ({}) },
}));
vi.mock("@/lib/editor/useAutocompleteBridge", () => ({
  useAutocompleteBridge: () => ({ options: {}, enabled: false }),
}));
vi.mock("@convex-dev/prosemirror-sync/tiptap", () => ({
  useTiptapSync: () => ({
    isLoading: false,
    initialContent: null,
    extension: null,
    create: vi.fn(),
  }),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_test", imageUrl: "" } }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => null,
  useMutation: () => vi.fn(),
}));
vi.mock("@convex-dev/presence/react", () => ({
  default: (_presence: unknown, roomId: string) => {
    h.usePresenceRoomId = roomId;
    return h.presenceList;
  },
}));
vi.mock("@/lib/editor/collaborativeCursors", () => ({
  CollaborativeCursors: {},
  collaborativeCursorsKey: { getState: () => null },
  getUserColor: () => "#0284c7",
  getContrastTextColor: () => "#ffffff",
}));
vi.mock("use-debounce", () => ({
  useDebouncedCallback: () => {
    const fn = Object.assign((...args: unknown[]) => h.debounced(...args), {
      cancel: h.cancel,
      flush: h.flush,
    });
    return fn;
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("./TreeProvider", () => ({
  useTreeContext: () => h.tree,
}));

import { EditorProvider, useEditorContext } from "./EditorProvider";
import type { PreviewVersion } from "./EditorProvider";

type Ctx = ReturnType<typeof useEditorContext>;
let ctx: Ctx;
function Probe() {
  ctx = useEditorContext();
  return null;
}

function mount() {
  return render(
    <EditorProvider>
      <Probe />
    </EditorProvider>,
  );
}
function ui() {
  return (
    <EditorProvider>
      <Probe />
    </EditorProvider>
  );
}

function version(text: string): PreviewVersion {
  return {
    _id: "v1",
    content: doc(text),
    title: "T",
    createdAt: 1,
    isPreRestore: false,
    author: null,
  };
}

function setNote(over: Record<string, unknown> = {}) {
  h.tree.selectedNote = {
    _id: "n1",
    title: "Note",
    content: doc("current"),
    role: "owner",
    ...over,
  };
}

describe("preview", () => {
  beforeEach(() => {
    h.fake.isDestroyed = false;
    h.fake.isEditable = true;
    h.fake.current = JSON.parse(doc("current"));
    h.fake.getJSON.mockImplementation(() => h.fake.current);
    h.fake.setEditable.mockImplementation((v: boolean) => {
      h.fake.isEditable = v;
    });
    h.fake.commands.setContent.mockImplementation((c: unknown) => {
      h.fake.current = c;
    });
    h.fake.on.mockImplementation(
      (ev: string, cb: (arg: { editor: unknown }) => void) => {
        if (ev === "update") h.fake.listener = cb;
      },
    );
    setNote();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("flushes pending save then swaps in the version content", () => {
    mount();
    h.fake.commands.setContent.mockClear();
    act(() => ctx.enterPreview(version("old")));
    expect(h.flush).toHaveBeenCalledTimes(1);
    expect(h.flush.mock.invocationCallOrder[0]).toBeLessThan(
      h.fake.commands.setContent.mock.invocationCallOrder[0],
    );
    expect(h.fake.commands.setContent).toHaveBeenCalledWith(
      JSON.parse(doc("old")),
      { emitUpdate: false },
    );
    expect(ctx.previewVersion?._id).toBe("v1");
  });

  it("invalid JSON version content falls back to empty without throwing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    h.fake.commands.setContent.mockClear();
    const bad = { ...version("x"), content: "{not json" };
    expect(() => act(() => ctx.enterPreview(bad))).not.toThrow();
    expect(h.fake.commands.setContent).toHaveBeenCalledWith("", {
      emitUpdate: false,
    });
  });

  it("getCurrentContent is null while previewing and restored after exit", () => {
    mount();
    expect(ctx.getCurrentContent()).not.toBeNull();
    act(() => ctx.enterPreview(version("old")));
    expect(ctx.getCurrentContent()).toBeNull();
    act(() => ctx.exitPreview());
    expect(ctx.getCurrentContent()).toBe(JSON.stringify(h.fake.current));
  });

  it("toggles editability around preview", () => {
    mount();
    act(() => ctx.enterPreview(version("old")));
    expect(h.fake.setEditable).toHaveBeenLastCalledWith(false, false);
    act(() => ctx.exitPreview());
    expect(h.fake.setEditable).toHaveBeenLastCalledWith(true, false);
  });

  it("ignores remote content changes while previewing; exit shows latest", () => {
    const { rerender } = mount();
    act(() => ctx.enterPreview(version("old")));
    h.fake.commands.setContent.mockClear();
    setNote({ content: doc("remote") });
    rerender(ui());
    expect(h.fake.commands.setContent).not.toHaveBeenCalled();
    expect(h.tree.onUpdateNoteContent).not.toHaveBeenCalled();
    act(() => ctx.exitPreview());
    expect(h.fake.commands.setContent).toHaveBeenCalledWith(
      JSON.parse(doc("remote")),
      { emitUpdate: false },
    );
    expect(ctx.previewVersion).toBeNull();
  });

  it("exitPreview(override) shows the override, not the stale stored content", () => {
    const { rerender } = mount();
    act(() => ctx.enterPreview(version("old")));
    h.fake.commands.setContent.mockClear();
    act(() => ctx.exitPreview(doc("R")));
    expect(h.fake.commands.setContent).toHaveBeenCalledWith(
      JSON.parse(doc("R")),
      { emitUpdate: false },
    );
    expect(h.fake.commands.setContent).not.toHaveBeenCalledWith(
      JSON.parse(doc("current")),
      expect.anything(),
    );
    setNote({ content: doc("R") });
    rerender(ui());
    expect(h.tree.onUpdateNoteContent).not.toHaveBeenCalled();
  });

  it("Ctrl+S does not save while previewing", () => {
    mount();
    // make saveStatus "unsaved" so Ctrl+S would otherwise save
    act(() => h.fake.listener?.({ editor: h.fake }));
    act(() => ctx.enterPreview(version("old")));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      );
    });
    expect(h.tree.onUpdateNoteContent).not.toHaveBeenCalled();
  });

  it("update event does not schedule a save while previewing", () => {
    mount();
    act(() => ctx.enterPreview(version("old")));
    h.debounced.mockClear();
    act(() => h.fake.listener?.({ editor: h.fake }));
    expect(h.debounced).not.toHaveBeenCalled();
  });

  it("update event outside preview does schedule a save", () => {
    mount();
    act(() => h.fake.listener?.({ editor: h.fake }));
    expect(h.debounced).toHaveBeenCalled();
  });

  it("switching notes resets preview", () => {
    const { rerender } = mount();
    act(() => ctx.enterPreview(version("old")));
    expect(ctx.previewVersion).not.toBeNull();
    setNote({ _id: "n2", content: doc("other") });
    rerender(ui());
    expect(ctx.previewVersion).toBeNull();
    expect(ctx.getCurrentContent()).not.toBeNull();
  });
});

describe("leaving preview does not autosave (GAP-1)", () => {
  beforeEach(() => {
    h.fake.isDestroyed = false;
    h.fake.isEditable = true;
    h.fake.current = JSON.parse(doc("current"));
    h.fake.getJSON.mockImplementation(() => h.fake.current);
    // Mirror Tiptap: setEditable(editable, emitUpdate = true) emits "update".
    h.fake.setEditable.mockImplementation((v: boolean, emitUpdate = true) => {
      h.fake.isEditable = v;
      if (emitUpdate !== false) h.fake.listener?.({ editor: h.fake });
    });
    h.fake.commands.setContent.mockImplementation((c: unknown) => {
      h.fake.current = c;
    });
    h.fake.on.mockImplementation(
      (ev: string, cb: (arg: { editor: unknown }) => void) => {
        if (ev === "update") h.fake.listener = cb;
      },
    );
    setNote();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exitPreview(override) leaves saveStatus idle and schedules no save", () => {
    mount();
    act(() => ctx.enterPreview(version("old")));
    h.debounced.mockClear();
    act(() => ctx.exitPreview(doc("R")));
    expect(ctx.saveStatus).toBe("idle");
    expect(h.debounced).not.toHaveBeenCalled();
  });

  it("exitPreview() (back to current) leaves saveStatus idle and schedules no save", () => {
    mount();
    act(() => ctx.enterPreview(version("old")));
    h.debounced.mockClear();
    act(() => ctx.exitPreview());
    expect(ctx.saveStatus).toBe("idle");
    expect(h.debounced).not.toHaveBeenCalled();
  });

  it("normal typing still autosaves", () => {
    mount();
    h.debounced.mockClear();
    act(() => h.fake.listener?.({ editor: h.fake }));
    expect(ctx.saveStatus).toBe("unsaved");
    expect(h.debounced).toHaveBeenCalledTimes(1);
  });

  describe("tree-level presence", () => {
    it("connects presence room to rootNoteId", () => {
      h.tree.rootNoteId = "tree_root_xyz";
      mount();
      expect(h.usePresenceRoomId).toBe("tree_root_xyz");
    });

    it("filters presenceList to current note while keeping treePresenceList complete", () => {
      h.tree.rootNoteId = "tree_root_xyz";
      h.presenceList = [
        {
          userId: "user_on_same_note",
          online: true,
          data: { activeNoteId: "n1", cursor: { from: 1, to: 2 } },
        },
        {
          userId: "user_on_other_note",
          online: true,
          data: { activeNoteId: "other_note", cursor: { from: 5, to: 10 } },
        },
      ];
      mount();
      expect(ctx.treePresenceList).toHaveLength(2);
      expect(ctx.presenceList).toHaveLength(1);
      expect(ctx.presenceList?.[0]?.userId).toBe("user_on_same_note");
    });
  });

  describe("closing or navigating away flushes pending edits", () => {
    it("flushes pending edits when EditorProvider unmounts", () => {
      const { unmount } = mount();
      h.flush.mockClear();
      unmount();
      expect(h.flush).toHaveBeenCalledTimes(1);
    });

    it("flushes and prompts confirmation on beforeunload when unsaved", () => {
      mount();
      act(() => h.fake.listener?.({ editor: h.fake }));
      expect(ctx.saveStatus).toBe("unsaved");

      h.flush.mockClear();
      const event = new Event("beforeunload", {
        cancelable: true,
      }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(h.flush).toHaveBeenCalledTimes(1);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("does not flush or prompt on beforeunload when idle", () => {
      mount();
      expect(ctx.saveStatus).toBe("idle");

      h.flush.mockClear();
      const event = new Event("beforeunload", {
        cancelable: true,
      }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(h.flush).not.toHaveBeenCalled();
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it("flushes on visibilitychange when hidden and unsaved", () => {
      mount();
      act(() => h.fake.listener?.({ editor: h.fake }));
      expect(ctx.saveStatus).toBe("unsaved");

      h.flush.mockClear();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(h.flush).toHaveBeenCalledTimes(1);
    });

    it("applies incoming remote content changes when user is idle", () => {
      const { rerender } = mount();
      h.fake.commands.setContent.mockClear();
      setNote({ content: doc("incoming remote changes") });
      rerender(ui());
      expect(h.fake.commands.setContent).toHaveBeenCalledWith(
        JSON.parse(doc("incoming remote changes")),
        { emitUpdate: false },
      );
    });
  });
});
