// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

type Pref = { enabled: boolean } | null | undefined;
let pref: Pref;
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: pref }) }));
const acceptFn = vi.fn();
const dismissFn = vi.fn(async () => null);
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({}),
  useConvexMutation: (ref: { __name: string }) =>
    ref.__name === "accept" ? acceptFn : dismissFn,
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    aiSuggestions: {
      getMyAutocomplete: { __name: "get" },
      accept: { __name: "accept" },
      dismiss: { __name: "dismiss" },
    },
  },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

import { useAutocompleteBridge } from "./useAutocompleteBridge";
import {
  resetAutocompleteStatus,
  setAutocompletePaused,
  useAutocompleteStatus,
} from "./autocompleteStatus";

const fetchMock = vi.fn();
beforeEach(() => {
  pref = { enabled: true };
  acceptFn.mockReset();
  dismissFn.mockClear();
  toastError.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetAutocompleteStatus();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function bridge(noteId: string | null = "n1") {
  return renderHook(() => useAutocompleteBridge(noteId ?? undefined)).result
    .current;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("useAutocompleteBridge", () => {
  it("is enabled only for the effective server value and a known note", () => {
    expect(bridge().options.isEnabled()).toBe(true);
    pref = { enabled: false };
    expect(bridge().options.isEnabled()).toBe(false);
    pref = null;
    expect(bridge().options.isEnabled()).toBe(false);
    pref = undefined;
    expect(bridge().options.isEnabled()).toBe(false);
    pref = { enabled: true };
    expect(bridge(null).options.isEnabled()).toBe(false);
  });

  it("never requests on a device with no fine pointer (no Tab to accept with)", () => {
    const mm = (matches: boolean) =>
      vi.stubGlobal("matchMedia", (q: string) => ({ matches, media: q }));
    mm(false);
    expect(bridge().options.isEnabled()).toBe(false);
    mm(true);
    expect(bridge().options.isEnabled()).toBe(true);
  });

  it("posts only the note id and the text before the cursor, with the abort signal", async () => {
    fetchMock.mockResolvedValue(
      json({ status: "suggestion", suggestionId: "s1", text: " more" }),
    );
    const ac = new AbortController();
    const r = await bridge("note_9").options.request({
      textBefore: "Hello there",
      signal: ac.signal,
    });
    expect(r).toEqual({ status: "suggestion", id: "s1", text: " more" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/complete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      noteId: "note_9",
      textBefore: "Hello there",
    });
    expect(init.signal).toBe(ac.signal);
  });

  it("maps paused / none / errors quietly (never a toast)", async () => {
    const b = bridge();
    const call = () =>
      b.options.request({
        textBefore: "Hello",
        signal: new AbortController().signal,
      });
    fetchMock.mockResolvedValueOnce(json({ status: "paused", reason: "rate" }));
    expect(await call()).toEqual({ status: "paused" });
    fetchMock.mockResolvedValueOnce(json({ status: "none" }));
    expect(await call()).toEqual({ status: "none" });
    fetchMock.mockResolvedValueOnce(json({ error: "PREMIUM_REQUIRED" }, 403));
    expect(await call()).toEqual({ status: "paused" });
    fetchMock.mockResolvedValueOnce(json({ error: "PROVIDER_ERROR" }, 502));
    expect(await call()).toEqual({ status: "none" });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("accept returns the server text, or the typed code when refused", async () => {
    const b = bridge();
    acceptFn.mockResolvedValueOnce({ text: " more", cost: 1, replayed: false });
    expect(await b.options.accept("s1")).toEqual({ ok: true, text: " more" });
    expect(acceptFn).toHaveBeenCalledWith({ suggestionId: "s1" });

    acceptFn.mockRejectedValueOnce(new ConvexError("INSUFFICIENT_CREDITS"));
    expect(await b.options.accept("s2")).toEqual({
      ok: false,
      code: "INSUFFICIENT_CREDITS",
    });
    acceptFn.mockRejectedValueOnce(new Error("network"));
    expect(await b.options.accept("s3")).toEqual({
      ok: false,
      code: undefined,
    });
  });

  it("a refused accept is the one loud failure: a toast with the matching message", () => {
    const b = bridge();
    b.options.onAcceptError?.("INSUFFICIENT_CREDITS");
    expect(toastError).toHaveBeenLastCalledWith(
      "AiCredits.errors.INSUFFICIENT_CREDITS",
    );
    b.options.onAcceptError?.(undefined);
    expect(toastError).toHaveBeenLastCalledWith("AiCredits.errors.GENERIC");
  });

  it("dismiss calls the mutation and swallows failures", async () => {
    const b = bridge();
    dismissFn.mockRejectedValueOnce(new Error("offline"));
    expect(() => b.options.dismiss("s1")).not.toThrow();
    expect(dismissFn).toHaveBeenCalledWith({ suggestionId: "s1" });
    await Promise.resolve();
  });

  it("clears the paused state when autocomplete is not enabled", () => {
    setAutocompletePaused(true);
    pref = { enabled: false };
    bridge();
    // The bridge's effect resets the shared store when not enabled.
    const { result } = renderHook(() => useAutocompleteStatus());
    expect(result.current.paused).toBe(false);
  });
});
