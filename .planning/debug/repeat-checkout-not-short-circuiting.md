---
status: resolved
trigger: "repeat-checkout-not-short-circuiting: When a signed-in user who already has an active (or should-be-active) Stripe subscription clicks 'Upgrade to Pro' again, the app is supposed to short-circuit and redirect straight to the success page without creating a new Stripe Checkout Session, and it must reuse the existing Stripe Customer object. Instead, clicking the button redirects to a fresh Stripe Checkout page again, and a red error message appears under the button (exact text unreadable)."
created: 2026-07-10T01:10:00Z
updated: 2026-07-10T13:15:00Z
---

## Resolution Update (2026-07-10T13:15:00Z)

Confirmed: the short-circuit never triggered because `getSubscription` never returned an active row, for the same reason as success-page-stuck-loading.md (webhook never delivered — see that file's Resolution Update for the two root causes). The "red error text" was the previously-swallowed `checkoutSessionCreationFailed`, made readable by Plan 03-06's page.tsx logging plus a follow-up fix logging the actual `StripeInvalidRequestError` in actions.ts's checkout-session catch — which is what revealed the second root cause (missing Stripe Products/Prices on the test-mode account). Both fixed; Test 3 now passes. See 03-07-SUMMARY.md.

## Current Focus

hypothesis: CONFIRMED (see Resolution) — the short-circuit check itself (`existing?.status === "active"`) is correctly written, but is fed a non-active/null result by `getSubscription`, for the same underlying reason the parallel "success page stuck loading" bug (Test 2) never resolves to "active." Separately, the query call that feeds this check sits outside the action's only try/catch, which is the most likely source of the visible red error text.
test: code read of app/[locale]/(marketing)/pricing/actions.ts, app/[locale]/(marketing)/pricing/page.tsx, convex/subscriptions.ts, convex/stripeWebhooks.ts, app/api/webhooks/stripe/route.ts, convex/schema.ts, and unit test coverage (actions.test.ts, subscriptions.test.ts) to confirm what is and isn't exercised end-to-end.
expecting: N/A — goal is find_root_cause_only, diagnosis complete.
next_action: report ROOT CAUSE FOUND to caller. Do not fix (out of scope for this mode). Recommend the fix land alongside (or be sequenced after) the "success-page-stuck-loading" debug session since they share a suspected root cause.

## Symptoms

expected: Triggering "Upgrade to Pro" again as the same signed-in (now-active) user redirects straight to /en/checkout/success with no new Stripe Checkout Session created; only ONE Stripe Customer object exists in the Dashboard for this user's email.
actual: Clicking "Upgrade to Pro" again redirects to a NEW checkout.stripe.com session instead of short-circuiting. Red error text (unreadable) appears under the "Upgrade to Pro" button.
errors: Unreadable red error text under the button — traced to `page.tsx`'s generic `error` boolean state, rendering `t("checkoutError")` with no logged detail (see Evidence).
reproduction: Test 3 in .planning/phases/03-checkout-flow-pricing-page/03-HUMAN-UAT.md — same user as Test 1/2 (who just completed a real Stripe test-mode checkout), visits /en/pricing again, clicks "Upgrade to Pro" a second time.
started: Discovered 2026-07-10 during Phase 3 manual UAT, immediately after Test 2 failed ("still coming"/never shows active even after refresh).

## Eliminated

(none — this was a single-pass code-reading investigation; no hypotheses were tested and disproven in the traditional experimental sense, since live Stripe/Convex access is not available to this agent. See Resolution/blind_spots for what remains unverified live.)

## Evidence

- timestamp: 2026-07-10T01:15:00Z
  checked: app/[locale]/(marketing)/pricing/actions.ts (full file)
  found: |
  The short-circuit logic is:
  const existing = await convex.query(api.subscriptions.getSubscription, {});
  if (existing?.status === "active") { redirect to success; return; }
  This line is logically correct on its face. The `existing` lookup is fetched exactly once and reused both for the short-circuit AND for Stripe customer reuse (`customer: existing.stripeCustomerId`).
  Critically, this `convex.query()` call (line 32) is OUTSIDE the try/catch block (which starts later, at line 42, wrapped ONLY around `stripe.checkout.sessions.create()`). Any exception thrown by the Convex query call is NOT caught here — it propagates straight out of `createCheckoutSession` uncaught.
  implication: If `getSubscription` throws (auth handshake failure, malformed token, etc.) instead of merely returning null, the resulting error is indistinguishable, at the UI layer, from a genuine Stripe API failure — both surface as the same generic `error=true` / red `checkoutError` text on the client, because `page.tsx`'s catch block does not distinguish where the throw originated.

- timestamp: 2026-07-10T01:18:00Z
  checked: git show e5793d5 (IDOR fix commit) diff of actions.ts and convex/subscriptions.ts
  found: |
  This commit (same session, ~1hr before UAT Test 3 was run) is what introduced the current auth handshake:
  const { userId, redirectToSignIn, getToken } = await auth();
  ...
  const convexToken = await getToken({ template: "convex" });
  if (convexToken) convex.setAuth(convexToken);
  const existing = await convex.query(api.subscriptions.getSubscription, {});
  Previously, the query passed `{ clerkUserId: userId }` directly (an IDOR — client/caller-supplied identity, now removed for security). The replacement requires a real Clerk-issued JWT (via the "convex" JWT template) to be exchanged and attached via `convex.setAuth()` so that `ctx.auth.getUserIdentity()` on the Convex side resolves to the caller's own identity.
  implication: This exact code path (`getToken({template:"convex"})` inside a Next.js Server Action, followed by `ConvexHttpClient.setAuth()` + `.query()`) is BRAND NEW as of this session and is not exercised by any real Clerk/Convex round-trip in CI — see next entry.

- timestamp: 2026-07-10T01:20:00Z
  checked: app/[locale]/(marketing)/pricing/actions.test.ts (full file)
  found: |
  All three unit tests mock `getToken` to always resolve a hardcoded string ("mock_convex_token") and mock `ConvexHttpClient.setAuth`/`.query` entirely (vi.mock on "convex/browser" and "@clerk/nextjs/server"). No test exercises a real Clerk JWT template exchange or a real Convex auth handshake. The "already-active short-circuits" test only proves the `if (existing?.status === "active")` branch works IF `existing` is truthy with `status: "active"` — it does not (and cannot, as a unit test) prove that `existing` will actually be non-null/active against the real Convex backend after a real webhook write.
  implication: The only place this real auth handshake + real webhook-write timing has ever been exercised is human UAT — and UAT is exactly where it failed (Test 2 and Test 3).

- timestamp: 2026-07-10T01:24:00Z
  checked: convex/subscriptions.ts getSubscription query (full function)
  found: |
  export const getSubscription = query({
  args: {},
  handler: async ctx => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db.query("subscriptions")
  .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
  .unique();
  },
  });
  Uses `identity.subject` (raw JWT `sub` claim = Clerk's bare `user_xxx` id) as the lookup key, matching the format written by the webhook (`session.metadata.clerkUserId`, itself sourced from `auth().userId`, also bare `user_xxx`). Format alignment checked against convex/subscriptions.test.ts, which asserts this exact contract via `t.withIdentity({ subject: "user_1" })`. No format mismatch found here (distinguished from the unrelated `users.ts` `tokenIdentifier` pattern, which is a different, Convex-specific composite string used only for the `users` table, not `subscriptions`).
  Also noted: `.unique()` throws at runtime if the index ever returns MORE than one row for the same `clerkUserId` (Convex has no schema-level unique constraint — `by_clerkUserId` is a plain, non-unique index per convex/schema.ts).
  implication: If `upsertSubscription`'s existing-row lookup-then-insert-or-patch ever raced (e.g. `checkout.session.completed` and `customer.subscription.updated` webhooks arriving close together and both reading "no existing row" before either commits), TWO rows with the same clerkUserId could theoretically exist, which would make EVERY subsequent `getSubscription` call throw via `.unique()` — a plausible independent explanation for the red error text (uncaught exception surfacing through the unguarded query call, per the first evidence entry). This is a secondary/lower-confidence hypothesis — Convex's serializable mutation semantics normally prevent this race, but it has not been ruled out without live Convex Dashboard log access.

- timestamp: 2026-07-10T01:28:00Z
  checked: app/api/webhooks/stripe/route.ts and convex/stripeWebhooks.ts (checkout.session.completed handling, full path)
  found: |
  route.ts correctly synthesizes a `subscriptionSnapshot` (status/currentPeriodEnd/cancelAtPeriodEnd) by fetching the full Stripe Subscription object BEFORE forwarding the event to Convex, but only `if (typeof session.subscription === "string")`. convex/stripeWebhooks.ts's `processWebhookEvent` then reads `session.subscriptionSnapshot?.status ?? "active"` and maps it via `mapStripeSubscriptionStatus()`, writing the row through `internal.subscriptions.upsertSubscription`. On its face, for a normal (non-expanded) checkout session, `session.subscription` is a string ID, so this path looks correctly wired and should write `status: "active"` after a successful test-mode payment.
  implication: Nothing found in this webhook path definitively contradicts it working correctly — the actual break is more likely either (a) the webhook never reaching/completing against Convex in this environment (secret mismatch, forwarder not running, clerkUserId missing from the event), which is squarely the subject of the parallel "success page stuck loading" debug investigation, or (b) the duplicate-row/.unique() race described above. This agent did not have access to live Stripe CLI logs or the Convex Dashboard to confirm which.

- timestamp: 2026-07-10T01:30:00Z
  checked: app/[locale]/(marketing)/pricing/page.tsx handleUpgrade/error rendering (full component)
  found: |
  async function handleUpgrade() {
  setError(false); setIsPending(true);
  try { await createCheckoutSession(locale); }
  catch { setError(true); }
  finally { setIsPending(false); }
  }
  ...{error && <p className="text-sm text-destructive">{t("checkoutError")}</p>}
  The catch block is a bare `catch {}` — it discards the actual thrown error entirely (no console.error/logging), which is exactly why the user "could not capture/read the exact error text": there is no error text to read beyond the generic, static `t("checkoutError")` i18n string. This is independently a diagnosability gap regardless of root cause.
  implication: Confirms the visible "red text" is the static `checkoutError` translation string, not a message derived from the actual thrown error. Any exception from EITHER the unguarded `convex.query()` call OR the guarded `stripe.checkout.sessions.create()` call renders identically to the user, with zero distinguishing detail logged anywhere (client or server).

## Resolution

root_cause: |
Two compounding issues, both centered on app/[locale]/(marketing)/pricing/actions.ts:

1. PRIMARY (shared with the parallel "success-page-stuck-loading" gap): The short-circuit condition
   `if (existing?.status === "active")` is itself correctly implemented, but `existing` (from
   `convex.query(api.subscriptions.getSubscription, {})`) never actually resolves to an active row for
   the UAT test user — the same symptom already proven live in Test 2, where the success page never
   transitioned to "active" even after a manual refresh, using this exact same query. Because the
   short-circuit has nothing to trigger on, `createCheckoutSession` always falls through to
   `stripe.checkout.sessions.create()` and creates/redirects to a brand-new Checkout Session every time —
   this is the direct, deterministic cause of "clicking Upgrade to Pro again redirects to a NEW Stripe
   Checkout session instead of short-circuiting." (Whether the underlying defect is the webhook never
   writing the row, a secret/env mismatch, or the new `getToken({template:"convex"})` auth handshake
   failing silently, is the scope of the parallel debug session — this agent did not have live
   Stripe/Convex log access to pin down which.)

2. SECONDARY (specific to the visible red error text): `convex.query(api.subscriptions.getSubscription, {})`
   (actions.ts line 32) sits OUTSIDE the function's only try/catch, which is narrowly scoped around just
   `stripe.checkout.sessions.create()` (lines 42-65). This query call is fed by a brand-new,
   never-live-tested auth handshake introduced in commit e5793d5 (`getToken({ template: "convex" })` +
   `ConvexHttpClient.setAuth()`), which unit tests mock away entirely (actions.test.ts) and which has
   never round-tripped against a real Clerk JWT template + real Convex backend before this UAT session.
   If that handshake — or the query itself (e.g. via a `.unique()` violation if a duplicate
   `subscriptions` row for this clerkUserId ever got created by a webhook race) — throws instead of
   cleanly resolving to null/a row, the exception propagates uncaught straight through
   `createCheckoutSession` to `page.tsx`'s bare `catch { setError(true) }`, which discards the real error
   and renders only the static, generic `checkoutError` string — exactly matching "I see an issue but I
   can't log it, there is a red text under it."

fix: (not applied — goal is find_root_cause_only)
verification: (not applicable — no fix applied)
files_changed: []
