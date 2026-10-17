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
import { ConvexError } from "convex/values";

type PageState = { data: unknown; isPending: boolean };
const pagesByCursor: Record<string, PageState> = {};
const getMock = vi.fn();
const enterPreview = vi.fn();
const exitPreview = vi.fn();
const editor: { previewVersion: { _id: string } | null } = {
  previewVersion: null,
};
const mq = { matches: false };

vi.mock("@tanstack/react-query", () => ({
  useQueries: ({
    queries,
  }: {
    queries: { args: { cursor: string | null } }[];
  }) =>
    queries.map(
      q =>
        pagesByCursor[String(q.args.cursor)] ?? {
          data: undefined,
          isPending: true,
        },
    ),
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: vi.fn((fn: unknown, args: unknown) => ({ fn, args })),
  useConvexMutation: () => vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: getMock }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    noteVersions: {
      list: "noteVersions.list",
      get: "noteVersions.get",
      restore: "noteVersions.restore",
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

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});

vi.mock("@/components/SharedUnavailable", () => ({
  default: () => <div>unavailable</div>,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({
    previewVersion: editor.previewVersion,
    enterPreview,
    exitPreview,
  }),
}));

vi.mock("@/providers/TreeProvider", () => ({
  useTreeContext: () => ({ selectedNote: { title: "Current" } }),
}));

import { toast } from "sonner";
import { convexQuery } from "@convex-dev/react-query";
import HistoryPanel from "./HistoryPanel";
import HistoryButton from "./HistoryButton";

const NOW = new Date(2026, 9, 17, 15, 0, 0).getTime();
const HOUR = 3600_000;

function ver(
  id: string,
  createdAt: number,
  extra: Record<string, unknown> = {},
) {
  return {
    _id: id,
    createdAt,
    isPreRestore: false,
    author: { name: "Ann Lee", avatarUrl: null },
    ...extra,
  };
}

function page(
  versions: unknown[],
  extra: Record<string, unknown> = {},
): PageState {
  return {
    isPending: false,
    data: {
      versions,
      hasMore: false,
      continueCursor: "end",
      hasHidden: false,
      ...extra,
    },
  };
}

function renderPanel(onOpenChange = vi.fn(), noteId = "n1") {
  return render(
    <HistoryPanel noteId={noteId as never} open onOpenChange={onOpenChange} />,
  );
}

describe("history panel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (const k of Object.keys(pagesByCursor)) delete pagesByCursor[k];
    getMock.mockReset();
    enterPreview.mockReset();
    exitPreview.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(convexQuery).mockClear();
    editor.previewVersion = null;
    mq.matches = false;
    window.matchMedia = ((q: string) => ({
      matches: mq.matches,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as never;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows skeleton rows while loading", () => {
    pagesByCursor["null"] = { data: undefined, isPending: true };
    const { container } = renderPanel();
    expect(
      container.ownerDocument.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("null data shows unavailable and exits preview", () => {
    pagesByCursor["null"] = { data: null, isPending: false };
    editor.previewVersion = { _id: "v1" };
    renderPanel();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(exitPreview).toHaveBeenCalled();
  });

  it("empty state", () => {
    pagesByCursor["null"] = page([]);
    renderPanel();
    expect(screen.getByText("emptyHeading")).toBeInTheDocument();
    expect(screen.getByText("emptyBody")).toBeInTheDocument();
  });

  it("groups by day, shows badge, unknown author, no emails", () => {
    pagesByCursor["null"] = page([
      ver("a", NOW - HOUR),
      ver("b", NOW - 2 * HOUR, { isPreRestore: true, author: null }),
      ver("c", NOW - 5 * 24 * HOUR, {
        author: { name: null, avatarUrl: null },
      }),
    ]);
    renderPanel();
    expect(screen.getByText("today")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.getAllByText("beforeRestore")).toHaveLength(1);
    expect(screen.getAllByText("unknownAuthor")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("@");
  });

  it("hint card only when hasHidden", () => {
    pagesByCursor["null"] = page([ver("a", NOW)], { hasHidden: true });
    const { unmount } = renderPanel();
    expect(screen.getByText(/hintOlderVersions/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "upgradeLink" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    unmount();
    pagesByCursor["null"] = page([ver("a", NOW)]);
    renderPanel();
    expect(screen.queryByText(/hintOlderVersions/)).toBeNull();
  });

  it("queries the first page with cursor null and 30 items", () => {
    pagesByCursor["null"] = page([ver("a", NOW)]);
    renderPanel();
    expect(convexQuery).toHaveBeenCalledWith("noteVersions.list", {
      noteId: "n1",
      cursor: null,
      numItems: 30,
    });
  });

  it("show more appends the next page via continueCursor", () => {
    pagesByCursor["null"] = page([ver("a", NOW - HOUR)], {
      hasMore: true,
      continueCursor: "c1",
    });
    pagesByCursor["c1"] = page([ver("b", NOW - 2 * HOUR)]);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "showMore" }));
    expect(convexQuery).toHaveBeenCalledWith("noteVersions.list", {
      noteId: "n1",
      cursor: "c1",
      numItems: 30,
    });
    const rows = screen.getAllByRole("button", { pressed: false });
    expect(rows).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "showMore" })).toBeNull();
  });

  it("reaches every version past 100 over four pages", () => {
    for (let p = 0; p < 4; p++) {
      const vs = Array.from({ length: 30 }, (_, i) =>
        ver(`v${p}-${i}`, NOW - (p * 30 + i) * 60_000),
      );
      pagesByCursor[p === 0 ? "null" : `c${p}`] = page(vs, {
        hasMore: p < 3,
        continueCursor: `c${p + 1}`,
      });
    }
    renderPanel();
    for (let p = 0; p < 3; p++) {
      fireEvent.click(screen.getByRole("button", { name: "showMore" }));
    }
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(120);
    expect(screen.queryByRole("button", { name: "showMore" })).toBeNull();
  });

  it("disables show more while the last page is pending", () => {
    pagesByCursor["null"] = page([ver("a", NOW)], {
      hasMore: true,
      continueCursor: "c1",
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "showMore" }));
    // page c1 pending and first page still says hasMore -> button hidden or disabled
    const btn = screen.queryByRole("button", { name: "showMore" });
    if (btn) expect(btn).toBeDisabled();
  });

  it("resets to a single first-page query when noteId changes", () => {
    pagesByCursor["null"] = page([ver("a", NOW)], {
      hasMore: true,
      continueCursor: "c1",
    });
    pagesByCursor["c1"] = page([ver("b", NOW)]);
    const { rerender } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "showMore" }));
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(2);
    rerender(
      <HistoryPanel noteId={"n2" as never} open onOpenChange={vi.fn()} />,
    );
    // After reset only the first page is queried, so page 2 rows are gone
    // and showMore is back because page 1 still reports hasMore.
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "showMore" }),
    ).toBeInTheDocument();
  });

  it("row select fetches the version and enters preview", async () => {
    pagesByCursor["null"] = page([ver("a", NOW)]);
    getMock.mockResolvedValue({
      _id: "a",
      noteId: "n1",
      title: "T",
      content: "{}",
      createdAt: NOW,
      isPreRestore: false,
      author: null,
    });
    const onOpenChange = vi.fn();
    renderPanel(onOpenChange);
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    await waitFor(() => expect(enterPreview).toHaveBeenCalled());
    expect(getMock).toHaveBeenCalledWith("noteVersions.get", {
      versionId: "a",
    });
    expect(enterPreview).toHaveBeenCalledWith({
      _id: "a",
      content: "{}",
      title: "T",
      createdAt: NOW,
      isPreRestore: false,
      author: null,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the previewed row aria-pressed", () => {
    pagesByCursor["null"] = page([ver("a", NOW), ver("b", NOW - HOUR)]);
    editor.previewVersion = { _id: "a" };
    renderPanel();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("get returning null toasts errorLoad", async () => {
    pagesByCursor["null"] = page([ver("a", NOW)]);
    getMock.mockResolvedValue(null);
    const onOpenChange = vi.fn();
    renderPanel(onOpenChange);
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("errorLoad"));
    expect(enterPreview).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("get throwing out-of-window toasts errorOutOfWindow", async () => {
    pagesByCursor["null"] = page([ver("a", NOW)]);
    getMock.mockRejectedValue(new ConvexError("VERSION_OUT_OF_WINDOW"));
    const onOpenChange = vi.fn();
    renderPanel(onOpenChange);
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("errorOutOfWindow"),
    );
    expect(enterPreview).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes the sheet on narrow viewports after a successful select", async () => {
    mq.matches = true;
    pagesByCursor["null"] = page([ver("a", NOW)]);
    getMock.mockResolvedValue({
      _id: "a",
      noteId: "n1",
      title: "T",
      content: "{}",
      createdAt: NOW,
      isPreRestore: false,
      author: null,
    });
    const onOpenChange = vi.fn();
    renderPanel(onOpenChange);
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("history button", () => {
  afterEach(cleanup);

  it("renders an accessible toggle and calls onClick", () => {
    const onClick = vi.fn();
    render(<HistoryButton isOpen onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "buttonAria" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});
