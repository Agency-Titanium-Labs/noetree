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
      "CONTEXT_TOO_DEEP",
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

  it("matches exact and prefix messages, never a code buried in other text", () => {
    expect(aiErrorCode(new Error("RATE_LIMITED"))).toBe("RATE_LIMITED");
    expect(
      aiErrorCode(new Error('Uncaught ConvexError: "CONTEXT_TOO_DEEP"')),
    ).toBe("CONTEXT_TOO_DEEP");
    expect(aiErrorCode(new Error("NOTE_NOT_FOUND: gone"))).toBe(
      "NOTE_NOT_FOUND",
    );
    // A substring is not a match.
    expect(aiErrorCode(new Error("see NOTE_NOT_OWNED in the docs"))).toBeNull();
    expect(aiErrorCode(new Error("XNOTE_NOT_OWNED"))).toBeNull();
    expect(aiErrorCode(new Error("NOTE_NOT_OWNEDX"))).toBeNull();
    expect(aiErrorCode(new Error("user typed RATE_LIMITED"))).toBeNull();
  });

  it("has en and fr messages with key parity for every code", async () => {
    const en = (await import("../../messages/en.json")).default;
    const fr = (await import("../../messages/fr.json")).default;
    const enErrors = en.AiCredits.errors as Record<string, string>;
    const frErrors = fr.AiCredits.errors as Record<string, string>;
    expect(Object.keys(frErrors).sort()).toEqual(Object.keys(enErrors).sort());
    for (const code of [
      "CONTEXT_TOO_LARGE",
      "CONTEXT_TOO_DEEP",
      "NOTE_NOT_FOUND",
      "NOTE_NOT_OWNED",
      "PURCHASED_CONTENT_EXCLUDED",
    ]) {
      expect(enErrors[code]).toBeTruthy();
      expect(frErrors[code]).toBeTruthy();
    }
  });
});
