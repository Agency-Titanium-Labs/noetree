// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (ns: string) => (key: string, vars?: Record<string, unknown>) =>
      `${ns}.${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`,
}));

const mutationMock = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({ mutation: mutationMock, query: vi.fn() }),
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

import AiTreeProposal from "./AiTreeProposal";
import { toggleNode, acceptedNodes, selectAll } from "@/lib/ai/treeClient";
import type { ProposalNode } from "@/convex/helpers/aiTreeProposal";

const NODES: ProposalNode[] = [
  { key: "a", parent: null, title: "Chapter 1", content: "Intro **text**" },
  { key: "b", parent: "a", title: "Section 1.1", content: "Details" },
  { key: "c", parent: "b", title: "Point 1.1.1", content: "" },
  { key: "d", parent: null, title: "Chapter 2", content: "More" },
];

const checkbox = (name: RegExp | string) =>
  screen.getByRole("checkbox", { name });

beforeEach(() => {
  mutationMock.mockReset();
  toastSuccess.mockReset();
});
afterEach(cleanup);

describe("checkbox preview (TREE-03)", () => {
  it("renders every proposed note as a checked, leveled list item", () => {
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(/"level":1/);
    expect(items[1]).toHaveTextContent(/"level":2/);
    expect(items[2]).toHaveTextContent(/"level":3/);
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toBeChecked();
    }
    expect(screen.getByText(/proposalCount/)).toHaveTextContent(
      '{"selected":4,"total":4}',
    );
  });

  it("is a plain list with labelled checkboxes, not an ARIA tree (M4)", () => {
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
    expect(screen.getByRole("list")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    for (const box of boxes) {
      // Every checkbox has an accessible name (its label).
      expect(box).toHaveAccessibleName(/\S/);
    }
  });

  it("unchecking a parent unchecks all its descendants, not its siblings", () => {
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    fireEvent.click(checkbox(/Section 1.1/));
    expect(checkbox(/Section 1.1/)).not.toBeChecked();
    expect(checkbox(/Point 1.1.1/)).not.toBeChecked();
    expect(checkbox(/Chapter 1/)).toBeChecked();
    expect(checkbox(/Chapter 2/)).toBeChecked();
    fireEvent.click(checkbox(/Chapter 1/));
    expect(checkbox(/Section 1.1/)).not.toBeChecked();
    expect(screen.getByText(/proposalCount/)).toHaveTextContent(
      '{"selected":1,"total":4}',
    );
  });

  it("re-checking a child re-checks its ancestors (no orphan)", () => {
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    fireEvent.click(checkbox(/Chapter 1/));
    fireEvent.click(checkbox(/Point 1.1.1/));
    expect(checkbox(/Point 1.1.1/)).toBeChecked();
    expect(checkbox(/Section 1.1/)).toBeChecked();
    expect(checkbox(/Chapter 1/)).toBeChecked();
  });

  it("pure rule: toggle and accepted nodes", () => {
    const all = selectAll(NODES);
    const off = toggleNode(NODES, all, "a");
    expect([...off]).toEqual(["d"]);
    expect(acceptedNodes(NODES, off).map(n => n.key)).toEqual(["d"]);
  });

  it("creates nothing until Apply is clicked", () => {
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    fireEvent.click(checkbox(/Chapter 2/));
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("renders hostile node content as inert text (no image, no link, no raw HTML)", () => {
    const hostile: ProposalNode[] = [
      {
        key: "x",
        parent: null,
        title: "<img src=x onerror=alert(1)>",
        content:
          "![p](https://evil.test/p.png) [go](javascript:alert(1)) <script>alert(1)</script>",
      },
    ];
    const { container } = render(
      <AiTreeProposal noteId="root" nodes={hostile} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /AiTree.preview/ }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("the Apply button is disabled with an empty selection", () => {
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: /selectNone/ }));
    expect(screen.getByRole("button", { name: /AiTree.apply/ })).toBeDisabled();
  });
});

describe("apply and undo (TREE-04, TREE-05)", () => {
  it("sends only the checked notes with one stable batch id, then offers undo", async () => {
    mutationMock.mockResolvedValueOnce({
      replayed: false,
      rootNoteId: "root",
      noteIds: ["n1", "n2"],
      createdAt: Date.now(),
    });
    const onApplied = vi.fn();
    render(
      <AiTreeProposal noteId="root" nodes={NODES} onApplied={onApplied} />,
    );
    fireEvent.click(checkbox(/Section 1.1/));
    fireEvent.click(screen.getByRole("button", { name: /AiTree.apply/ }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const [, args] = mutationMock.mock.calls[0];
    expect(args.rootNoteId).toBe("root");
    expect(args.nodes.map((n: ProposalNode) => n.key)).toEqual(["a", "d"]);
    expect(typeof args.batchId).toBe("string");
    expect(onApplied).toHaveBeenCalledWith(args.batchId);
    expect(await screen.findByText(/appliedNote/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /AiTree.undo/ }),
    ).toBeInTheDocument();
    // The toast carries an undo action too.
    expect(toastSuccess.mock.calls[0][1].action.label).toMatch(/AiTree.undo/);
  });

  it("a failed apply keeps the same batch id for the retry (idempotent replay)", async () => {
    mutationMock.mockRejectedValueOnce(new Error("network"));
    mutationMock.mockResolvedValueOnce({
      replayed: true,
      rootNoteId: "root",
      noteIds: ["n1"],
      createdAt: Date.now(),
    });
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: /AiTree.apply/ }));
    expect(await screen.findByTestId("ai-tree-error")).toHaveTextContent(
      "AiTree.errors.GENERIC",
    );
    fireEvent.click(screen.getByRole("button", { name: /AiTree.apply/ }));
    await screen.findByText(/appliedNote/);
    expect(mutationMock.mock.calls[0][1].batchId).toBe(
      mutationMock.mock.calls[1][1].batchId,
    );
  });

  it("shows a typed refusal when the note is no longer editable", async () => {
    mutationMock.mockRejectedValueOnce(
      Object.assign(new Error("x"), { data: "APPLY_NOT_EDITABLE" }),
    );
    render(<AiTreeProposal noteId="root" nodes={NODES} />);
    fireEvent.click(screen.getByRole("button", { name: /AiTree.apply/ }));
    expect(await screen.findByTestId("ai-tree-error")).toHaveTextContent(
      "AiTree.errors.APPLY_NOT_EDITABLE",
    );
    // Nothing was created: Apply is available again.
    expect(screen.getByRole("button", { name: /AiTree.apply/ })).toBeEnabled();
  });

  async function applied() {
    mutationMock.mockResolvedValueOnce({
      replayed: false,
      rootNoteId: "root",
      noteIds: ["n1"],
      createdAt: Date.now(),
    });
    const onUndone = vi.fn();
    render(<AiTreeProposal noteId="root" nodes={NODES} onUndone={onUndone} />);
    fireEvent.click(screen.getByRole("button", { name: /AiTree.apply/ }));
    await screen.findByRole("button", { name: /AiTree.undo/ });
    return onUndone;
  }

  it("undo succeeds: the batch is gone and the panel is told", async () => {
    const onUndone = await applied();
    mutationMock.mockResolvedValueOnce({ ok: true, deleted: 4 });
    fireEvent.click(screen.getByRole("button", { name: /AiTree.undo/ }));
    await waitFor(() => expect(onUndone).toHaveBeenCalled());
    expect(await screen.findByText("AiTree.undone")).toBeInTheDocument();
    expect(mutationMock.mock.calls[1][1]).toEqual({
      batchId: mutationMock.mock.calls[0][1].batchId,
    });
  });

  it("undo is refused: the blocking titles are listed and nothing is hidden", async () => {
    await applied();
    mutationMock.mockResolvedValueOnce({
      ok: false,
      blockers: ["Edited by me", "My own child"],
    });
    fireEvent.click(screen.getByRole("button", { name: /AiTree.undo/ }));
    const alert = await screen.findByTestId("ai-tree-error");
    expect(alert).toHaveTextContent("AiTree.undoBlocked");
    expect(within(alert).getByText("Edited by me")).toBeInTheDocument();
    expect(within(alert).getByText("My own child")).toBeInTheDocument();
    // The undo control stays (the state is still "applied").
    expect(
      screen.getByRole("button", { name: /AiTree.undo/ }),
    ).toBeInTheDocument();
  });

  it("undo after 24 hours shows the expiry message", async () => {
    await applied();
    mutationMock.mockRejectedValueOnce(
      Object.assign(new Error("x"), { data: "UNDO_EXPIRED" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /AiTree.undo/ }));
    expect(await screen.findByTestId("ai-tree-error")).toHaveTextContent(
      "AiTree.undoExpired",
    );
  });
});
