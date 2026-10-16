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

const state: { unread: number; list: unknown[] | undefined } = {
  unread: 0,
  list: [],
};
const push = vi.fn();
const markRead = vi.fn(async () => null);
const markAllRead = vi.fn(async () => null);

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { fn: string; enabled?: boolean }) =>
    opts.fn === "notifications.unreadCount"
      ? { data: state.unread, isPending: false }
      : { data: state.list, isPending: state.list === undefined },
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: vi.fn((fn: unknown, args: unknown) => ({ fn, args })),
  useConvexMutation: (fn: string) =>
    fn === "notifications.markRead" ? markRead : markAllRead,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    notifications: {
      unreadCount: "notifications.unreadCount",
      list: "notifications.list",
      markRead: "notifications.markRead",
      markAllRead: "notifications.markAllRead",
    },
  },
}));

const messages: Record<string, string> = {
  title: "Notifications",
  bellAria: "bellAria {count}",
  markAllRead: "markAllRead",
  emptyHeading: "emptyHeading",
  emptyBody: "emptyBody",
  textComment: "{actor} commented on {title}",
  textReply: "{actor} replied on {title}",
  unread: "unread",
  unknownActor: "unknownActor",
};

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const t = (key: string, vars?: Record<string, unknown>) => {
      let m = messages[key] ?? key;
      for (const [k, v] of Object.entries(vars ?? {}))
        m = m.replace(`{${k}}`, String(v));
      return m;
    };
    t.rich = (key: string, vars: Record<string, unknown>) => {
      let m = messages[key] ?? key;
      for (const [k, v] of Object.entries(vars))
        if (typeof v !== "function") m = m.replace(`{${k}}`, String(v));
      return m;
    };
    return t;
  },
}));

vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/useStoreUserEffect", () => ({
  useStoreUserEffect: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

import NotificationBell from "./NotificationBell";

function item(over: Record<string, unknown> = {}) {
  return {
    _id: "n1",
    _creationTime: Date.now() - 60_000,
    kind: "comment",
    isRead: false,
    actor: { name: "Alice", avatarUrl: null },
    noteTitle: "My Note",
    href: { kind: "app", noteId: "note1", commentId: "c1" },
    ...over,
  };
}

function openBell() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /bellAria/ }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole("button", { name: /bellAria/ }));
}

beforeEach(() => {
  state.unread = 0;
  state.list = [];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("NotificationBell", () => {
  it("renders no badge at 0 and aria-label with count", () => {
    render(<NotificationBell />);
    expect(screen.queryByTestId("notification-badge")).toBeNull();
    expect(
      screen.getByRole("button", { name: "bellAria 0" }),
    ).toBeInTheDocument();
  });

  it("shows the count and 99+ at 100", () => {
    state.unread = 5;
    const { unmount } = render(<NotificationBell />);
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("5");
    unmount();
    state.unread = 100;
    render(<NotificationBell />);
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("99+");
  });

  it("lists rows on open without marking read, with sr-only unread", () => {
    state.unread = 1;
    state.list = [
      item(),
      item({ _id: "n2", isRead: true, noteTitle: "Other" }),
    ];
    render(<NotificationBell />);
    openBell();
    expect(screen.getByText("Alice commented on My Note")).toBeInTheDocument();
    expect(screen.getByText("Alice commented on Other")).toBeInTheDocument();
    expect(screen.getAllByText("unread")).toHaveLength(1);
    expect(markRead).not.toHaveBeenCalled();
  });

  it("renders reply text for reply kind", () => {
    state.unread = 1;
    state.list = [item({ kind: "reply" })];
    render(<NotificationBell />);
    openBell();
    expect(screen.getByText("Alice replied on My Note")).toBeInTheDocument();
  });

  it("clicking an unread app row marks read then navigates", async () => {
    state.unread = 1;
    state.list = [item()];
    render(<NotificationBell />);
    openBell();
    fireEvent.click(screen.getByText("Alice commented on My Note"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/notes/note1?comments=1&c=c1"),
    );
    expect(markRead).toHaveBeenCalledWith({ notificationId: "n1" });
  });

  it("public row navigates to /p/", async () => {
    state.list = [
      item({
        isRead: true,
        href: { kind: "public", noteId: "note2", commentId: "c2" },
      }),
    ];
    render(<NotificationBell />);
    openBell();
    fireEvent.click(screen.getByText("Alice commented on My Note"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/p/note2?comments=1&c=c2"),
    );
  });

  it("read row does not call markRead but navigates", async () => {
    state.list = [item({ isRead: true })];
    render(<NotificationBell />);
    openBell();
    fireEvent.click(screen.getByText("Alice commented on My Note"));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(markRead).not.toHaveBeenCalled();
  });

  it("mark all read disabled at 0, enabled and working above 0", () => {
    render(<NotificationBell />);
    openBell();
    expect(screen.getByRole("button", { name: /markAllRead/ })).toBeDisabled();
    cleanup();
    state.unread = 3;
    render(<NotificationBell />);
    openBell();
    const btn = screen.getByRole("button", { name: /markAllRead/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(markAllRead).toHaveBeenCalled();
  });

  it("empty list shows empty state", () => {
    state.list = [];
    render(<NotificationBell />);
    openBell();
    expect(screen.getByText("emptyHeading")).toBeInTheDocument();
    expect(screen.getByText("emptyBody")).toBeInTheDocument();
  });

  it("null actor name renders unknownActor", () => {
    state.list = [item({ actor: { name: null, avatarUrl: null } })];
    render(<NotificationBell />);
    openBell();
    expect(
      screen.getByText("unknownActor commented on My Note"),
    ).toBeInTheDocument();
  });
});
