import {
  COMPLETE_MAX_BODY_BYTES,
  COMPLETE_SYSTEM_PROMPT,
  buildCompleteUserPrompt,
  cleanCompletion,
  completeBodySchema,
  hasEnoughPrefix,
  tailContext,
} from "./completePrompt";
import { COMPLETE_TIMEOUT_MS, completeMaxOutputTokens } from "./completeConfig";
import { chatErrorResponse } from "./chatErrors";
import {
  JSON_TYPE,
  beginErrorCode,
  errorName,
  isCrossSite,
  readBodyCapped,
} from "./chatHandler";
import type { PausedReason } from "../../convex/helpers/aiSuggestionState";

/**
 * Framework-free core of POST /api/ai/complete (21-CONTEXT D-07). Same
 * posture as the chat route (cross-site and non-JSON refused before auth,
 * Clerk-authenticated, secret check, hard body cap, typed error mapping) with
 * a non-streamed, short generation:
 *
 *  1. guards, auth, body (note id + text before the cursor, nothing else)
 *  2. suggestions.issue: Premium gate, ownership, purchased refusal, kill
 *     switch, credit pre-check, 5-unresolved cap and 20/min bucket, all in ONE
 *     Convex transaction BEFORE any model call. A limit answers
 *     { status: "paused" } (HTTP 200, no error), never an error toast.
 *  3. the model call (about 60 output tokens), note text framed as data
 *  4. suggestions.fill stores the text with the shared secret
 *
 * Nothing is debited here. A failed or empty generation dismisses the issued
 * row so it does not count against the unresolved cap.
 */

export type IssueResult =
  | { status: "issued"; suggestionId: string; title: string; expiresAt: number }
  | { status: "paused"; reason: PausedReason };

/** Authenticated with the user's token. */
export type CompleteClient = {
  issue(args: { noteId: string }): Promise<IssueResult>;
  dismiss(args: { suggestionId: string }): Promise<unknown>;
};

/** Unauthenticated: `fill` is guarded by the shared secret instead. */
export type FillClient = {
  fill(args: { suggestionId: string; text: string }): Promise<boolean>;
};

export type Completer = {
  complete(
    input: { system: string; prompt: string; maxOutputTokens: number },
    signal: AbortSignal,
  ): Promise<string>;
};

export type CompleteDeps = {
  getAuth(): Promise<{ userId: string | null; token: string | null }>;
  hasSettleSecret(): boolean;
  createClient(token: string): CompleteClient;
  createFillClient(): FillClient;
  completer: Completer;
  timeoutMs?: number;
  maxOutputTokens?: number;
};

export type CompleteResponse =
  | { status: "suggestion"; suggestionId: string; text: string }
  | { status: "none" }
  | { status: "paused"; reason: PausedReason };

function json(body: CompleteResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function handleCompleteRequest(
  req: Request,
  deps: CompleteDeps,
): Promise<Response> {
  if (isCrossSite(req)) return chatErrorResponse("FORBIDDEN");
  if (!JSON_TYPE.test(req.headers.get("content-type") ?? "")) {
    return chatErrorResponse("UNSUPPORTED_MEDIA_TYPE");
  }

  const { userId, token } = await deps.getAuth();
  if (!userId || !token) return chatErrorResponse("UNAUTHENTICATED");

  if (!deps.hasSettleSecret()) {
    console.error("[ai/complete] INTERNAL_WEBHOOK_SECRET is not configured");
    return chatErrorResponse("INTERNAL");
  }

  let raw: string | null;
  try {
    raw = await readBodyCapped(req, COMPLETE_MAX_BODY_BYTES);
  } catch {
    return chatErrorResponse("BAD_REQUEST");
  }
  if (raw === null) return chatErrorResponse("PAYLOAD_TOO_LARGE");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return chatErrorResponse("BAD_REQUEST");
  }
  const parsed = completeBodySchema.safeParse(parsedJson);
  if (!parsed.success) return chatErrorResponse("BAD_REQUEST");
  const { noteId } = parsed.data;
  const textBefore = tailContext(parsed.data.textBefore);

  // Nothing to continue: no Convex write, no model call, no limit consumed.
  if (!hasEnoughPrefix(textBefore)) return json({ status: "none" });

  const client = deps.createClient(token);
  let issued: IssueResult;
  try {
    issued = await client.issue({ noteId });
  } catch (err) {
    const code = beginErrorCode(err);
    if (code) return chatErrorResponse(code);
    console.error("[ai/complete] issue failed:", errorName(err));
    return chatErrorResponse("INTERNAL");
  }
  if (issued.status === "paused") {
    return json({ status: "paused", reason: issued.reason });
  }

  const dismissQuietly = async () => {
    try {
      await client.dismiss({ suggestionId: issued.suggestionId });
    } catch {
      // The row expires on its own; the cleanup cron removes it.
    }
  };

  // One signal for: the client going away (a new keystroke aborts the fetch)
  // and the call budget.
  const controller = new AbortController();
  const onReqAbort = () => controller.abort();
  if (req.signal.aborted) controller.abort();
  else req.signal.addEventListener("abort", onReqAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? COMPLETE_TIMEOUT_MS,
  );

  let text: string;
  try {
    text = await deps.completer.complete(
      {
        system: COMPLETE_SYSTEM_PROMPT,
        prompt: buildCompleteUserPrompt({ title: issued.title, textBefore }),
        maxOutputTokens: deps.maxOutputTokens ?? completeMaxOutputTokens(),
      },
      controller.signal,
    );
  } catch (err) {
    await dismissQuietly();
    if (controller.signal.aborted) return json({ status: "none" });
    console.error("[ai/complete] provider failed:", errorName(err));
    return chatErrorResponse("PROVIDER_ERROR");
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", onReqAbort);
  }

  const suggestion = cleanCompletion(text, textBefore);
  if (!suggestion || req.signal.aborted) {
    await dismissQuietly();
    return json({ status: "none" });
  }

  try {
    const stored = await deps.createFillClient().fill({
      suggestionId: issued.suggestionId,
      text: suggestion,
    });
    if (!stored) {
      await dismissQuietly();
      return json({ status: "none" });
    }
  } catch (err) {
    console.error("[ai/complete] fill failed:", errorName(err));
    await dismissQuietly();
    return chatErrorResponse("INTERNAL");
  }

  return json({
    status: "suggestion",
    suggestionId: issued.suggestionId,
    text: suggestion,
  });
}
