import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import {
  ALL_CHAT_ERROR_CODES,
  isChatErrorCode,
  parseChatError,
} from "./chatErrors";

describe("chat error codes and i18n (review H1)", () => {
  it.each([
    ["en", en],
    ["fr", fr],
  ])("every ChatErrorCode has an AiCredits.errors message in %s", (_l, m) => {
    const errors = m.AiCredits.errors as Record<string, string>;
    for (const code of ALL_CHAT_ERROR_CODES) {
      expect(errors[code], code).toBeTruthy();
    }
    expect(errors.GENERIC).toBeTruthy();
  });

  it("lists the chat-only codes explicitly", () => {
    for (const code of [
      "BAD_REQUEST",
      "INTERNAL",
      "UNKNOWN_ACTION",
      "INVALID_REQUEST_ID",
      "REQUEST_ID_REUSED",
      "FORBIDDEN",
      "UNSUPPORTED_MEDIA_TYPE",
      "PAYLOAD_TOO_LARGE",
      "PROMPT_TOO_LARGE",
    ]) {
      expect(isChatErrorCode(code), code).toBe(true);
    }
  });

  it("an unknown code is not parsed as a chat error (UI falls back to GENERIC)", () => {
    expect(
      parseChatError(new Error(JSON.stringify({ error: "SOMETHING_NEW" }))),
    ).toBeNull();
  });
});
