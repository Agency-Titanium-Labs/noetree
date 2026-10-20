# Deploy checklist: milestone v1.3 (IA et TVA marketplace)

**Status (2026-10-20): production is NOT being pushed for now.** Everything below is deferred until the user decides to ship. Branch of record: `milestone/v1.3` (local, not pushed). Prerequisite: PR #35 (`release/v1.2.0` to `main`, v1.2 go-live) merged first, because v1.3 builds on the v1.2 code.

Update this file as items are done. Never paste secrets here.

## 1. One-time data actions (run once per deployment, before the AI is exposed)

| Action                                                                                                                               | Local dev (`greedy-ermine-32`)                    | Dev/staging (`frugal-echidna-922`)                                                                                                              | Production (`wooden-puma-16`) |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Deploy v1.3 Convex functions and schema                                                                                              | Done 2026-10-19                                   | Pending (shared with dev.noetree.com and staging: deploy one branch at a time, the dev frontend still calls removed functions until redeployed) | Pending                       |
| Backfill purchased-content flag: `npx convex run notes:backfillPurchasedFlag '{}'` (internal, idempotent, repeat until `done: true`) | Done (0 notes flagged, no purchased copies there) | Pending (there are purchases in this deployment)                                                                                                | Pending                       |
| `AI_GATEWAY_API_KEY` set                                                                                                             | Done                                              | Done                                                                                                                                            | Done                          |
| `INTERNAL_WEBHOOK_SECRET` set (needed by `settleRun`)                                                                                | Present                                           | Present                                                                                                                                         | Present                       |
| `MARKETPLACE_VAT_RATE_BPS`                                                                                                           | Unset (VAT disabled, on purpose)                  | Unset                                                                                                                                           | Unset                         |

Backfill limit: a purchased sub-note moved out of its copy BEFORE the flag existed has no marker and no parent link, so the backfill cannot find it. Harmless while the AI is not live.

## 2. Test purchases (VAT-06): one per environment

Done locally on 2026-10-19 (Stripe test mode, Free seller, listing 10.00 EUR): rate 0 gives fee 2.00 EUR, rate 2000 gives fee 3.32 EUR (VAT 1.66 + commission 1.66, seller net 6.68). Details in `phases/23-marketplace-vat/23-VERIFICATION.md`.

Still to do when shipping, per environment (dev/staging, production):

1. Seller account with an active Stripe Connect account, buyer account different from the seller, listing at 10.00 EUR.
2. Buy with the Stripe test card (production uses the Stripe TEST account per the v1.2 runbook).
3. Check in the Stripe dashboard: charge equals the displayed price, `application_fee_amount` equals commission (plus VAT only if the rate env var is set), transfer to the seller correct.
4. Check the sales page and the purchase row (status paid, VAT snapshot).
5. Only if VAT is enabled: set `MARKETPLACE_VAT_RATE_BPS` (e.g. 2000) in that deployment first, and repeat with the expected split 166 / 166 / 668 on 10.00 EUR for a Free seller.

## 3. Credit and AI checks per environment

- One `beginRun` on an own note: accepted, 1 credit reserved, refunded by the reaper within about 5 minutes (verified locally on 2026-10-20).
- One `beginRun` on a note owned by someone else: refused with `NOTE_NOT_OWNED`, no debit (verified locally).
- A Free account on a Premium action: upsell, no debit.

## 4. Human decisions still open

- **AI Gateway plan (RESOLVED 2026-10-20: default chat model is now `google/gemini-2.5-flash-lite`, works on the free tier; set `AI_CHAT_MODEL=anthropic/claude-haiku-5.5` after buying AI Gateway credits if you want Claude).** The Vercel team is on the Gateway free tier: Anthropic models (default `anthropic/claude-haiku-5.5`) return 403 "Free tier users do not have access to this model". Either top up AI Gateway credits in the Vercel dashboard (paid), or change the default chat model in `lib/ai/models.ts` (free-tier models that answered on 2026-10-20: `google/gemini-2.5-flash-lite`, `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `openai/gpt-5-nano`, `meta/llama-3.1-8b`, `mistral/ministral-3b`). Env override: `AI_CHAT_MODEL`.

- VAT-01: accountant sign-off (`phases/23-marketplace-vat/23-VAT-DECISION.md`). Until signed the VAT stays disabled.
- Revoke and recreate the two AI Gateway keys if this conversation transcript is ever shared (they were pasted in chat). Spending caps are set in the Vercel dashboard.
- Vercel Node version is already 22.x. Convex Node actions (Phase 22 embeddings) will need their own Node 22 setting in `convex.json`.

## 5. Not required before shipping, tracked for later

- WR-01: compare Stripe's real `application_fee_amount` with the stored snapshot in the marketplace webhook (needs an extra Stripe API call).
- No refund path exists for VAT or commission: manual runbook in `23-VAT-DECISION.md`.
- Phase 19 must not trust a client-supplied context or `noteId`, and must sanitize model output rendering (no auto-loaded images, no raw HTML, neutralised links). Done in Phase 19 (see `19-REVIEW.md`).
- **Dependency upgrades (follow-up, security F-05, found by the Phase 19 review; deliberately not done in the review-fix branch).** `pnpm audit --prod` on 2026-10-20 reports advisories on the installed versions:
  - `next` 16.2.9: several high advisories patched in `>=16.2.11` (Server Actions DoS and SSRF, middleware/proxy bypass with Turbopack and a single locale, SSRF in rewrites), critical ones patched in `>=16.3.3` (RCE on Windows-hosted servers, RCE in the Image Optimization API with AVIF), `>=16.3.6` (RCE in `next/og` ImageResponse) and `>=16.3.8` (SSRF in Image Optimization, cache poisoning of SSG/ISR). Upgrade to the latest 16.x that clears all of them, then run the full test suite and `next build`. Until then, avoid exposing the Image Optimization API and `next/og` publicly if they are not needed (check `next.config`).
  - `@tiptap/core` 3.26.1: `>=3.30.4` (mergeAttributes `__proto__`) and `>=3.30.5` (Markdown attribute parsing ReDoS). `prosemirror-view`: high, XSS in paste handling, patched in `>=1.42.3` (pulled through `@tiptap/pm`). Upgrade the whole `@tiptap/*` set together and re-run the editor tests; this is the most relevant one for the note editor.
  - Lower priority transitive items from the same audit: `ws` (via `convex`) `>=8.21.0`, `sharp` `>=0.35.5`, `postcss`, `nanoid`, `browserslist`, `source-map-js`, `baseline-browser-mapping`.
  - Evidence: re-run `pnpm audit --prod`; the list above is its output at the date of the review.

## 6. Close-out verification (2026-10-20)

Gate on `milestone/v1.3`: 1575 tests green, `tsc` root and convex clean, eslint clean. Real browser test of tree undo on local dev: a batch with an edited note is refused with an explicit message listing the blocking note, nothing deleted (TREE-05 blocker case). Happy-path undo of an untouched batch is covered by `convex/aiTree.test.ts`.

## 7. Updates of 2026-10-20 (supersede sections 4 and 5 where they conflict)

- **VAT-01: accountant sign-off DONE** (confirmed by the user). VAT is still OFF by default: at go-live, set `MARKETPLACE_VAT_RATE_BPS` (e.g. 2000) per deployment and repeat the test purchase with the expected split 166 / 166 / 668 on 10.00 EUR (section 2, step 5).
- **Backfill `notes:backfillPurchasedFlag` stays a go-live action** (dev/staging and production), as in section 1.
- **Dependency upgrades DONE** on `milestone/v1.3`: `next` 16.2.9 to 16.4.2, all `@tiptap/*` 3.26.1 to 3.32.0. Overrides in `pnpm-workspace.yaml` clear the transitive advisories (`prosemirror-view` >=1.42.3, `ws`, `browserslist`, `baseline-browser-mapping`, `source-map-js`) and pin a single `prosemirror-model`/`prosemirror-transform` (two copies broke types and one ghost-text Tab test). `pnpm audit --prod`: no known vulnerabilities. Gate: 1575 tests, tsc root and convex, eslint, `next build` all green; editor smoke-tested in Chrome with no console error.
