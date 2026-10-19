import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES, aiErrorCode, isAiErrorCode } from "./aiErrors";

describe("AI typed error list", () => {
  it("contains the Phase 17 and Phase 18 codes", () => {
    for (const code of [
      "INSUFFICIENT_CREDITS",
      "PREMIUM_REQUIRED",
      "RATE_LIMITED",
      "CONTEXT_TOO_LARGE",
      "NOTE_NOT_FOUND",
      "NOTE_NOT_OWNED",
      "PURCHASED_CONTENT_EXCLUDED",
    ]) {
      expect(isAiErrorCode(code)).toBe(true);
    }
    expect(new Set(AI_ERROR_CODES).size).toBe(AI_ERROR_CODES.length);
  });

  it("rejects unknown and non-string values", () => {
    expect(isAiErrorCode("NOPE")).toBe(false);
    expect(isAiErrorCode(42)).toBe(false);
    expect(isAiErrorCode(undefined)).toBe(false);
  });

  it("maps a ConvexError and a wrapped Error message to the code", () => {
    expect(aiErrorCode(new ConvexError("CONTEXT_TOO_LARGE"))).toBe(
      "CONTEXT_TOO_LARGE",
    );
    expect(
      aiErrorCode(new Error("[Request ID: x] Server Error NOTE_NOT_OWNED")),
    ).toBe("NOTE_NOT_OWNED");
    expect(aiErrorCode(new Error("boom"))).toBeNull();
    expect(aiErrorCode(null)).toBeNull();
  });
});
