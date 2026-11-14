# Phase 19: Streaming Chat (Free) - Research

**Researched:** 2026-10-20
**Method:** every API below was checked against the INSTALLED packages (`node_modules/ai/docs`, `node_modules/ai/dist` types, `node_modules/@ai-sdk/gateway`, `node_modules/next/dist/docs`), not memory.

## Installed versions

| Package           | Installed           | Notes                                                                                         |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `ai`              | 7.0.143             | ESM only, `engines.node >= 22`. 7.0.146 exists but the pnpm release-age policy resolved .143. |
| `@ai-sdk/react`   | 4.0.147             | `useChat`.                                                                                    |
| `@ai-sdk/gateway` | transitive of `ai`  | Provides the default provider: a plain `"provider/model"` string works.                       |
| `next`            | 16.2.9              | `after()` from `next/server` is stable.                                                       |
| `react-markdown`  | added in this phase | Safe-by-default Markdown (no raw HTML), used with `img`/`a` overridden.                       |

`package.json` gets `engines.node: ">=22"`.

## Findings that shape the design

1. **Model id.** `anthropic/claude-haiku-5.5` is in the installed Gateway `GatewayModelId` union (also `anthropic/claude-haiku-4.5`). Chat default = `anthropic/claude-haiku-5.5`, overridable by `AI_CHAT_MODEL` (server-only env). A plain string passed as `model` is resolved by the Gateway provider; auth is `AI_GATEWAY_API_KEY` locally or Vercel OIDC when deployed.
2. **Stream consumption.** v7 exposes `result.stream` (an `AsyncIterable<TextStreamPart>` and `ReadableStream`); `fullStream` is deprecated. A text delta part is `{ type: "text-delta", id, text }` (field is `text`, not `delta`). Mid-stream provider failures arrive as `{ type: "error", error }` parts, not thrown. `textStream` swallows errors, so the Gateway `LlmProvider` iterates `stream` and throws on `error` / `abort` parts. This is what lets Phase 17's `executeRun` decide the settle outcome from observable facts (first token, failure, abort).
3. **Abort.** `streamText({ abortSignal })`; when it fires the stream emits an `abort` part and pending promises reject. `timeout: { totalMs }` is also available; we instead link our own `AbortController` to `request.signal` plus a timer so a timeout is classified as an abort (not a provider failure).
4. **UI message protocol.** `createUIMessageStream({ execute({ writer }) })` + `createUIMessageStreamResponse({ stream })`. Chunks: `start`, `text-start|text-delta|text-end` (delta field is `delta`, ids must be consistent), `data-<name>` for custom data parts, `error` (`errorText`), `finish`. The client `useChat` reads them with `DefaultChatTransport`.
5. **useChat.** `DefaultChatTransport({ api, prepareSendMessagesRequest })` lets us replace the body (`messages`, plus our `requestId`, `noteId`, `locale`); non-2xx responses make `error.message` the response BODY TEXT, so the route returns JSON `{ error: CODE, ... }` and the client parses `error.message`. `sendMessage({ text })`, `stop()`, `regenerate()`, `setMessages`, `status` in `submitted | streaming | ready | error`.
6. **Why executeRun inside a UI stream.** `executeRun` (Phase 17) takes a `RunHost` and an `LlmProvider`, and already encodes: only the claimant streams, error/abort before/after first token, settle exactly once, settle failure never throws. The route calls `beginRun` BEFORE creating the stream (so gate failures become HTTP statuses), hands `executeRun` a host whose `begin()` returns that result, and the provider wrapper tees each chunk into the UI stream writer. Nothing about money is re-implemented.
7. **after().** `after(promise-returning callback)` in a Route Handler runs after the response and is extended by Vercel `waitUntil`; "`after` will run for the platform's configured max duration of the route", so the stream budget and the settle step share `maxDuration`.
8. **Durations.** `MAX_RUN_DURATION_MS = 120 s`, `RUN_TTL_MS = 300 s`. Route: `maxDuration = 120` (== MAX_RUN_DURATION_MS, < RUN_TTL). Stream timer = 100 s so settle in `after()` has 20 s of headroom, and the reaper (5 min) can never refund a live stream.
9. **Testing helper.** `MockLanguageModelV4` from `ai/test` exists, but Phase 17 already ships `createFakeProvider` (`LlmProvider`), which is what the route tests use (D-12). A small test also covers the real Gateway adapter against `MockLanguageModelV4` (no network) to prove error/abort parts are translated.
10. **Rate limit hint.** `beginRun` throws a bare `RATE_LIMITED` (no wait). The bucket refills 10 per minute, so the route returns `retryAfterSeconds = 6` (one token) and a `Retry-After` header; an operator block can be longer, the UI wording is "try again shortly".
11. **Clerk.** `/api` is matched by the `clerkMiddleware` matcher (`proxy.ts`) so `auth()` works, but `/api/ai` is not a protected route: the handler returns JSON 401 itself, then `getToken({ template: "convex" })` and `ConvexHttpClient.setAuth` (same as the marketplace server action).
12. **settleRun** needs `INTERNAL_WEBHOOK_SECRET` (server env only).

## Settle policy (Phase 17 `resolveSettlement`, unchanged)

| Event                                      | Outcome                 | Credit                                                |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------- |
| Stream finishes with >= 1 token            | `completed`             | charged                                               |
| Provider error before the first token      | `failed`                | refunded                                              |
| Provider error after the first token       | `failed`                | refunded (Phase 17 rule: provider error at any point) |
| Abort / client Stop / timeout before token | `aborted_before_output` | refunded                                              |
| Abort / client Stop / timeout after token  | `aborted_after_output`  | charge stands                                         |
| Empty clean stream                         | `failed`                | refunded                                              |
| Never settled (crash, function killed)     | reaper `expired`        | refunded                                              |

## Open points for a human

- Real Gateway smoke test (needs `AI_GATEWAY_API_KEY` in `.env.local`, or Vercel OIDC when deployed).
- Browser test with a real signed-in session.
- Confirm `anthropic/claude-haiku-5.5` is enabled for the team on the Gateway dashboard.
