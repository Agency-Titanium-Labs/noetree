// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import FloatingCommentCard from "./FloatingCommentCard";
import type { CommentThreadData } from "./CommentThread";

const mockAdd = vi.fn().mockResolvedValue(null);
const mockSetResolved = vi.fn().mockResolvedValue(null);
const mockRemove = vi.fn().mockResolvedValue(null);

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: (fn: unknown) => {
    if (fn === "comments.add") return mockAdd;
    if (fn === "comments.setResolved") return mockSetResolved;
    if (fn === "comments.remove") return mockRemove;
    return vi.fn().mockResolvedValue(null);
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    comments: {
      add: "comments.add",
      setResolved: "comments.setResolved",
      remove: "comments.remove",
    },
  },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
  useTranslations: () => (key: string) => key,
  useNow: () => new Date(100000 + 47 * 60 * 1000),
  useFormatter: () => ({
    relativeTime: () => "il y a 47 min",
    dateTime: () => "11 nov. 2026, 13:08",
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

function makeThread(
  options: {
    hasAnchor?: boolean;
    replies?: boolean;
    canDeleteRoot?: boolean;
    canDeleteReply?: boolean;
  } = {},
): CommentThreadData {
  return {
    root: {
      _id: "c-root" as never,
      _creationTime: 100000,
      body: "Root comment text",
      isDeleted: false,
      author: { name: "Alice", avatarUrl: null },
      isMine: true,
      canDelete: options.canDeleteRoot ?? false,
    },
    replies: options.replies
      ? [
          {
            _id: "c-reply" as never,
            _creationTime: 110000,
            body: "Reply comment text",
            isDeleted: false,
            author: { name: "Bob", avatarUrl: null },
            isMine: false,
            canDelete: options.canDeleteReply ?? false,
          },
        ]
      : [],
    resolvedAt: null,
    resolvedByName: null,
    anchor: options.hasAnchor
      ? { quote: "Sample anchor quote", from: 5, to: 25 }
      : null,
  };
}

describe("FloatingCommentCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const virtualRef = {
    current: {
      getBoundingClientRect: () => new DOMRect(100, 100, 50, 20),
    },
  };
  const target = { kind: "note" as const, noteId: "n1" as never };

  it("renders thread anchor quote, author, and comment body", () => {
    const thread = makeThread({ hasAnchor: true, replies: true });
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Sample anchor quote/)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Root comment text")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Reply comment text")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    const thread = makeThread();
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={onClose}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "close" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls setResolved mutation and onClose when resolve button is clicked", async () => {
    const onClose = vi.fn();
    const thread = makeThread();
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={onClose}
      />,
    );

    const resolveBtn = screen.getByRole("button", { name: "resolve" });
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      expect(mockSetResolved).toHaveBeenCalledWith({
        target,
        commentId: "c-root",
        resolved: true,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("submits a reply when form is submitted", async () => {
    const thread = makeThread();
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("replyPlaceholder");
    fireEvent.change(input, { target: { value: "My inline reply" } });

    const submitBtn = screen.getByRole("button", { name: "replyAction" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledWith({
        target,
        parentId: "c-root",
        body: "My inline reply",
      });
    });
  });

  it("calls removeComment when delete button is clicked with deleteDelayMs=0", async () => {
    const thread = makeThread({ canDeleteRoot: true });
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={vi.fn()}
        deleteDelayMs={0}
      />,
    );

    const deleteBtn = screen.getByRole("button", { name: "deleteAction" });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({
        target,
        commentId: "c-root",
      });
    });
  });

  it("shows undo toast on delete, and cancels removeComment when undo is clicked", async () => {
    const thread = makeThread({ canDeleteRoot: true });
    const onClose = vi.fn();
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={onClose}
        deleteDelayMs={1000}
      />,
    );

    const deleteBtn = screen.getByRole("button", { name: "deleteAction" });
    fireEvent.click(deleteBtn);

    expect(onClose).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      "deletedSuccess",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "undo",
          onClick: expect.any(Function),
        }),
      }),
    );

    // Trigger the undo action callback directly
    const toastCall = vi
      .mocked(toast)
      .mock.calls.find(c => c[0] === "deletedSuccess");
    const undoAction = (toastCall?.[1] as { action?: { onClick?: () => void } })
      ?.action;
    undoAction?.onClick?.();

    // Ensure mockRemove is never called
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does not show delete button on comments authored by others (isMine: false)", () => {
    const thread = makeThread({ canDeleteRoot: true });
    thread.root.isMine = false;
    render(
      <FloatingCommentCard
        target={target}
        thread={thread}
        canComment={true}
        isOpen={true}
        virtualRef={virtualRef}
        onClose={vi.fn()}
      />,
    );

    // Resolve button should be visible
    expect(screen.getByRole("button", { name: "resolve" })).toBeInTheDocument();
    // Delete button should NOT be visible for other people's comments
    expect(
      screen.queryByRole("button", { name: "deleteAction" }),
    ).not.toBeInTheDocument();
  });
});
