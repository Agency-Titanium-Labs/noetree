// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIsMac } from "./useIsMac";

describe("useIsMac", () => {
  it("returns a boolean", () => {
    const { result } = renderHook(() => useIsMac());
    expect(typeof result.current).toBe("boolean");
  });
});
