// @vitest-environment jsdom
// Live-update regression harness (GAP-1): the REAL HistoryPanel, the REAL
// TanStack QueryClient and the REAL ConvexQueryClient, over a fake Convex
// client that lets the test push query results like the server would.
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { getFunctionName } from "convex/server";

const NOW = new Date(2026, 9, 17, 15, 0, 0).getTime();
const HOUR = 3600_000;

vi.mock("convex/react", async importOriginal => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return { ...actual, useConvex: () => fake.client };
});

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
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
    previewVersion: null,
    enterPreview: vi.fn(),
    exitPreview: vi.fn(),
  }),
}));

import { api } from "@/convex/_generated/api";
import HistoryPanel from "./HistoryPanel";

// --- fake Convex client -----------------------------------------------------

type Listener = () => void;

class FakeConvex {
  values = new Map<string, unknown>();
  listeners = new Map<string, Set<Listener>>();
  url = "http://fake.convex.cloud";

  private key(fn: unknown, args: unknown) {
    const name = typeof fn === "string" ? fn : getFunctionName(fn as never);
    return name + JSON.stringify(args);
  }
  watchQuery = (fn: unknown, args: unknown) => {
    const k = this.key(fn, args);
    return {
      onUpdate: (cb: Listener) => {
        let set = this.listeners.get(k);
        if (!set) this.listeners.set(k, (set = new Set()));
        set.add(cb);
        return () => {
          set!.delete(cb);
        };
      },
      localQueryResult: () => this.values.get(k),
    };
  };
  query = async (fn: unknown, args: unknown) => this.values.get(this.key(fn, args));
  /** Update a value and notify subscribers, like a server transition. */
  push(fn: unknown, args: unknown, value: unknown) {
    const k = this.key(fn, args);
    this.values.set(k, value);
    for (const cb of this.listeners.get(k) ?? []) cb();
  }
  seed(fn: unknown, args: unknown, value: unknown) {
    this.values.set(this.key(fn, args), value);
  }
}

const fake: { client: FakeConvex } = { client: new FakeConvex() };

function makeQueryClient(convex: FakeConvex) {
  const convexQueryClient = new ConvexQueryClient(convex as never);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        retry: false,
        gcTime: Infinity,
      },
    },
  });
  convexQueryClient.connect(queryClient);
  return queryClient;
}

const ARGS = { noteId: "n1", cursor: null, numItems: 30 };

function ver(id: string, createdAt: number, isPreRestore = false) {
  return {
    _id: id,
    createdAt,
    isPreRestore,
    author: { name: "Ann Lee", avatarUrl: null },
  };
}
function listValue(versions: unknown[]) {
  return {
    versions,
    hasMore: false,
    continueCursor: "",
    hasHidden: false,
  };
}

const base = [ver("a", NOW - HOUR), ver("b", NOW - 2 * HOUR)];
const withRestore = [ver("r", NOW, true), ...base];

// TanStack's notifyManager defers observer notifications with setTimeout(0)
// (query-core 5.x), so a pushed server value reaches React one macrotask later.
const flushNotify = () => new Promise<void>(r => setTimeout(r, 0));

async function pushList(value: unknown) {
  await act(async () => {
    fake.client.push(api.noteVersions.list, ARGS, value);
    await flushNotify();
  });
}

function Harness({ open, qc }: { open: boolean; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <HistoryPanel noteId={"n1" as never} open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>
  );
}

describe("HistoryPanel live updates (real QueryClient + ConvexQueryClient)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    fake.client = new FakeConvex();
    fake.client.seed(api.noteVersions.list, ARGS, listValue(base));
    qc = makeQueryClient(fake.client);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function renderOpen(open = true) {
    const utils = render(<Harness open={open} qc={qc} />);
    if (open) {
      await screen.findAllByRole("button", { pressed: false });
    }
    return utils;
  }

  it("(a) new Before restore row renders immediately after a pushed update", async () => {
    await renderOpen();
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(2);
    expect(screen.queryByText("beforeRestore")).toBeNull();
    await pushList(listValue(withRestore));
    expect(screen.getByText("beforeRestore")).toBeInTheDocument();
  });

  it("(b) sheet closed and reopened before the update still shows the row", async () => {
    const { rerender } = await renderOpen();
    rerender(<Harness open={false} qc={qc} />);
    rerender(<Harness open qc={qc} />);
    await screen.findAllByRole("button", { pressed: false });
    await pushList(listValue(withRestore));
    expect(screen.getByText("beforeRestore")).toBeInTheDocument();
  });

  it("(c) update pushed while closed is shown on reopen", async () => {
    const { rerender } = await renderOpen();
    rerender(<Harness open={false} qc={qc} />);
    await pushList(listValue(withRestore));
    rerender(<Harness open qc={qc} />);
    expect(await screen.findByText("beforeRestore")).toBeInTheDocument();
  });

  it("(d) restore ordering: row is present once the restore promise resolves", async () => {
    await renderOpen();
    // Convex guarantee: the mutation promise resolves only after the query
    // transition containing its writes was applied.
    const restore = async () => {
      fake.client.push(api.noteVersions.list, ARGS, listValue(withRestore));
      return { content: "{}" };
    };
    await act(async () => {
      await restore();
      await flushNotify();
    });
    expect(screen.getByText("beforeRestore")).toBeInTheDocument();
  });
});
