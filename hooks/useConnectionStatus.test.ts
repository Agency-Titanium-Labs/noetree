// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectionStatus } from "./useConnectionStatus";

const mockState = {
  isWebSocketConnected: true,
  hasEverConnected: true,
  hasInflightRequests: false,
  timeOfOldestInflightRequest: null,
  connectionCount: 1,
};

vi.mock("convex/react", () => ({
  useConvexConnectionState: () => mockState,
}));

describe("useConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.isWebSocketConnected = true;
    mockState.hasEverConnected = true;
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  it("returns isDisconnected: false when online and web socket connected", () => {
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.isWebSocketConnected).toBe(true);
    expect(result.current.isDisconnected).toBe(false);
    expect(result.current.isReconnecting).toBe(false);
  });

  it("returns isDisconnected: true when browser goes offline", () => {
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isDisconnected).toBe(false);

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: false });
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.isDisconnected).toBe(true);
    expect(result.current.isReconnecting).toBe(false);

    act(() => {
      Object.defineProperty(navigator, "onLine", { value: true });
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isDisconnected).toBe(false);
  });

  it("returns isDisconnected: true and isReconnecting: true when WebSocket drops after connecting", () => {
    mockState.hasEverConnected = true;
    mockState.isWebSocketConnected = false;

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isWebSocketConnected).toBe(false);
    expect(result.current.isDisconnected).toBe(true);
    expect(result.current.isReconnecting).toBe(true);
  });

  it("does not report disconnected on initial handshake before ever connecting", () => {
    mockState.hasEverConnected = false;
    mockState.isWebSocketConnected = false;

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isDisconnected).toBe(false);
    expect(result.current.isReconnecting).toBe(false);
  });
});
