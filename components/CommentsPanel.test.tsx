// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

const state: { value: { data: unknown; isPending: boolean } } = {
  value: { data: undefined, isPending: true },
};
const auth = { isAuthenticated: false };

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => state.value,
}));

const mockMutation = vi.fn().mockResolvedValue(null);

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: vi.fn((fn: unknown, args: unknown) => ({ fn, args })),
  useConvexMutation: () => mockMutation,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    comments: {
      list: "comments.list",
      count: "comments.count",
      add: "comments.add",
      setResolved: "comments.setResolved",
      remove: "comments.remove",
    },
  },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    let m = key;
    for (const [k, v] of Object.entries(vars ?? {})) m += ` ${k}=${v}`;
    return m;
  },
}));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});

vi.mock("@/hooks/useStoreUserEffect", () => ({
  useStoreUserEffect: () => ({
    isLoading: false,
    isAuthenticated: auth.isAuthenticated,
  }),
}));

vi.mock("@/components/SharedUnavailable", () => ({
  default: () => <div>unavailable</div>,
}));

import CommentsPanel from "./CommentsPanel";
import CommentsButton from "./CommentsButton";

const target = { kind: "note", noteId: "n1" } as never;

function view(body: string, extra: Record<string, unknown> = {}) {
  return {
    _id: `c-${body}`,
    _creationTime: Date.now() - 60000,
    body,
    isDeleted: false,
    author: { name: "Ann Lee", avatarUrl: null },
    isMine: false,
    canDelete: false,
    ...extra,
  };
}

function thread(
  root: ReturnType<typeof view>,
  replies: unknown[] = [],
  r?: number,
  anchor?: { quote: string; from: number; to: number } | null,
) {
  return {
    root,
    replies,
    resolvedAt: r ?? null,
    resolvedByName: r ? "Bob" : null,
    anchor: anchor ?? null,
  };
}

function setData(data: unknown) {
  state.value = { data, isPending: false };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof CommentsPanel>> = {},
) {
  return render(
    <CommentsPanel target={target} open onOpenChange={() => {}} {...props} />,
  );
}

describe("CommentsPanel", () => {
  beforeEach(() => {
    auth.isAuthenticated = false;
  });
  afterEach(cleanup);

  it("anonymous: read-only with sign-in prompt", () => {
    setData({
      canComment: false,
      canModerate: false,
      threads: [thread(view("hello"))],
    });
    renderPanel();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("signInPrompt")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("signed in: composer and actions, no reply action on replies", () => {
    auth.isAuthenticated = true;
    setData({
      canComment: true,
      canModerate: false,
      threads: [thread(view("root"), [view("child")])],
    });
    renderPanel();
    expect(screen.getByPlaceholderText("placeholder")).toBeInTheDocument();
    expect(screen.getAllByText("replyAction")).toHaveLength(1);
    expect(screen.getAllByText("resolve")).toHaveLength(1);
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("hides resolved threads until Show resolved is on", () => {
    auth.isAuthenticated = true;
    setData({
      canComment: true,
      canModerate: false,
      threads: [thread(view("done"), [], Date.now()), thread(view("open"))],
    });
    renderPanel();
    expect(screen.queryByText("done")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText(/resolvedStub/)).toBeInTheDocument();
    expect(screen.getByText("unresolve")).toBeInTheDocument();
  });

  it("only resolved threads: shows emptyAllResolved", () => {
    auth.isAuthenticated = true;
    setData({
      canComment: true,
      canModerate: false,
      threads: [thread(view("done"), [], Date.now())],
    });
    renderPanel();
    expect(screen.getByText("emptyAllResolved")).toBeInTheDocument();
  });

  it("no threads, signed in: empty state", () => {
    auth.isAuthenticated = true;
    setData({ canComment: true, canModerate: false, threads: [] });
    renderPanel();
    expect(screen.getByText("emptyHeading")).toBeInTheDocument();
    expect(screen.getByText("emptyBodySignedIn")).toBeInTheDocument();
  });

  it("deleted root with reply renders stub and reply", () => {
    auth.isAuthenticated = true;
    setData({
      canComment: true,
      canModerate: false,
      threads: [
        thread(view("gone", { isDeleted: true, author: null }), [view("kept")]),
      ],
    });
    renderPanel();
    expect(screen.getByText("deletedStub")).toBeInTheDocument();
    expect(screen.getByText("kept")).toBeInTheDocument();
  });

  it("renders HTML bodies literally", () => {
    setData({
      canComment: false,
      canModerate: false,
      threads: [thread(view("<b>x</b>"))],
    });
    renderPanel();
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
  });

  it("renders thread anchor quote and triggers onScrollToAnchor on click", () => {
    auth.isAuthenticated = true;
    const mockScroll = vi.fn();
    const mockEditor = {
      isDestroyed: false,
      state: { doc: { content: { size: 500 } } },
      commands: {
        setTextSelection: vi.fn(),
        scrollIntoView: mockScroll,
      },
    } as unknown as import("@tiptap/core").Editor;

    setData({
      canComment: true,
      canModerate: false,
      threads: [
        thread(view("note comment"), [], undefined, {
          quote: "highlighted snippet",
          from: 10,
          to: 28,
        }),
      ],
    });
    renderPanel({ editor: mockEditor });

    expect(screen.getByText(/highlighted snippet/)).toBeInTheDocument();
    const anchorBtn = screen.getByRole("button", {
      name: /anchorGoTo/,
    });
    fireEvent.click(anchorBtn);

    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith({
      from: 10,
      to: 28,
    });
    expect(mockScroll).toHaveBeenCalled();
  });

  it("pendingAnchor shows quote preview in composer and submits anchor", async () => {
    auth.isAuthenticated = true;
    const onAnchorConsumed = vi.fn();
    const pendingAnchor = {
      quote: "selected text in note",
      from: 5,
      to: 25,
    };

    setData({
      canComment: true,
      canModerate: false,
      threads: [],
    });
    renderPanel({ pendingAnchor, onAnchorConsumed });

    expect(screen.getByText(/selected text in note/)).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("placeholder");
    fireEvent.change(textarea, { target: { value: "My inline feedback" } });

    const submitBtn = screen.getByRole("button", { name: "postCta" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockMutation).toHaveBeenCalledWith({
        target,
        body: "My inline feedback",
        anchor: pendingAnchor,
      });
      expect(onAnchorConsumed).toHaveBeenCalled();
    });
  });
});

describe("CommentsButton", () => {
  afterEach(cleanup);

  it("count 0: no badge", () => {
    setData(0);
    render(
      <CommentsButton target={target} isOpen={false} onClick={() => {}} />,
    );
    expect(screen.queryByText("99+")).toBeNull();
    expect(screen.getByRole("button").textContent).toBe("");
  });

  it("count 120: shows 99+ and aria includes 120", () => {
    setData(120);
    render(
      <CommentsButton target={target} isOpen={false} onClick={() => {}} />,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain(
      "120",
    );
  });
});
