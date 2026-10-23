---
status: resolved
trigger: "success-page-stuck-loading: After a real Stripe test-mode payment completes and Stripe redirects the user back to /en/checkout/success, the page is supposed to show a loading state then transition to Subscription active once the webhook writes the Convex subscriptions row. Instead it stays stuck indefinitely, and a hard refresh does NOT fix it."
created: 2026-07-10T00:00:00Z
updated: 2026-07-10T13:15:00Z
---

## Resolution Update (2026-07-10T13:15:00Z)

The "environmental, not a code defect" diagnosis below was correct as far as it went but **incomplete** — re-verification in Plan 03-07 surfaced two further, more specific root causes that had to be fixed before a real payment could succeed at all:

1. `stripe listen --forward-to localhost:3000/...` (no scheme) defaults to `http://`, but this project's dev server runs `next dev --experimental-https` — HTTPS-only. The webhook never reached the route handler at all. Fix: `stripe listen --forward-to https://localhost:3000/api/webhooks/stripe --skip-verify`.
2. Even with delivery fixed, checkout itself failed with `checkoutSessionCreationFailed` — the Stripe test-mode account had **zero Products and zero Prices**; `STRIPE_PRO_PRICE_ID`/`STRIPE_TOPUP_PRICE_ID` in `.env.local` were stale. Fix: recreated both via the Stripe CLI and updated `.env.local`. See 03-07-SUMMARY.md for full detail.

Both Test 2 and Test 3 in 03-HUMAN-UAT.md now pass.

## Current Focus

hypothesis: CONFIRMED — the Stripe webhook event for checkout.session.completed was never delivered to the local dev server, so the Convex subscriptions row was never written. Root cause is environmental/procedural, not a code defect: APP*URL=https://localhost:3000 (a non-publicly-reachable origin) is used to build Stripe's success_url AND is where the Stripe webhook must be delivered, but nothing in the local dev workflow guarantees `stripe listen --forward-to localhost:3000/api/webhooks/stripe` was running during the real Stripe test-mode payment. Browser redirect to /checkout/success works fine (that's a client-side browser navigation via Stripe's hosted checkout page, independent of the webhook), which is exactly why Test 1 in the UAT passed while Test 2 failed. Since the webhook literally never fires, the row never gets created — so no amount of waiting or refreshing will ever show "active": the reactive Convex query (and a fresh server-rendered fetch on refresh) both correctly return null/non-active because that is the true state of the database.
test: Traced the full write path (Stripe Checkout -> webhook route -> Convex action -> Convex mutation -> subscriptions table) and the full read path (SuccessStatus.tsx -> useQuery(convexQuery(api.subscriptions.getSubscription)) -> ctx.auth.getUserIdentity().subject -> by_clerkUserId index), found no code defect in either. Checked .env.local (var names/non-secret values only) and confirmed APP_URL is https://localhost:3000, a private origin unreachable by Stripe's servers without CLI forwarding or a tunnel. Checked 03-04-PLAN.md and confirmed the manual test procedure explicitly requires `stripe listen --forward-to localhost:3000/api/webhooks/stripe` to be running in a second terminal for this exact scenario.
expecting: This is the leading, well-evidenced hypothesis for goal:find_root_cause_only. It should be confirmed/refuted by checking Stripe Dashboard (test mode) -> Developers -> Webhooks -> [endpoint] -> recent event deliveries for the specific checkout.session.completed event, or by checking whether `stripe listen` was running in a terminal during the UAT test.
next_action: Hand off to caller (orchestrator/user) to check whether `stripe listen --forward-to localhost:3000/api/webhooks/stripe` was running during the UAT test, and check the Stripe CLI/Dashboard webhook event log for a checkout.session.completed delivery attempt (successful, failed-signature, or simply absent/never-sent). If confirmed absent, root cause is procedural (no code fix needed — re-run UAT with the CLI forwarder running). If a delivery attempt exists but failed (e.g., 400 Invalid signature), the STRIPE_WEBHOOK_SECRET in .env.local does not match the CLI forwarder's session secret (each `stripe listen` invocation prints its own whsec* value) — update .env.local's STRIPE_WEBHOOK_SECRET to match and restart the dev server.

## Symptoms

expected: `/en/checkout/success` shows a brief loading state immediately after redirect, then transitions to "Subscription active" once the Convex `subscriptions` row is written by the Stripe webhook handler for `checkout.session.completed`. It must never show "active" before the webhook lands, but it also must eventually show "active" once the webhook has landed.
actual: Page shows "still coming" (loading) state, and even after waiting and then doing a hard page refresh, it continues to show the same non-active state instead of "Subscription active".
errors: None captured by user (no console/network errors reported — browser-side redirect succeeds because it's independent of webhook delivery)
reproduction: Test 2 in UAT session .planning/phases/03-checkout-flow-pricing-page/03-HUMAN-UAT.md — visit /en/pricing, click "Upgrade to Pro", complete Stripe test-mode checkout with card 4242 4242 4242 4242, get redirected to /en/checkout/success
started: Discovered during manual UAT testing of Phase 3 (checkout-flow-pricing-page) on 2026-07-10

## Eliminated

- hypothesis: getSubscription query uses wrong/mismatched identity (identity.subject vs the clerkUserId written by the webhook), causing a permanent lookup mismatch even after the row exists.
  evidence: identity.subject in Convex+Clerk integration resolves to the Clerk `sub` JWT claim, which is the same Clerk userId returned by `auth()` server-side (used identically in app/[locale]/(marketing)/pricing/actions.ts to set `metadata: { clerkUserId: userId }` on the Stripe Checkout Session). Both the write path (webhook -> session.metadata.clerkUserId) and read path (query -> identity.subject) use the same underlying Clerk user id string. No evidence of mismatch in code.
  timestamp: 2026-07-10T00:15:00Z

- hypothesis: session.subscriptionSnapshot is a fabricated/non-existent Stripe field causing mapStripeSubscriptionStatus to always fall through incorrectly.
  evidence: app/api/webhooks/stripe/route.ts explicitly synthesizes `event.data.object.subscriptionSnapshot` server-side (fetches the full Subscription via stripe.subscriptions.retrieve before forwarding the event to Convex) specifically because a raw Checkout Session lacks status/period-end fields. This is intentional enrichment, not a bug.
  timestamp: 2026-07-10T00:16:00Z

- hypothesis: ConvexProviderWithClerk / useQuery(convexQuery(...)) reactivity is broken, so the client never re-renders even though the row was written.
  evidence: Even if true, this alone cannot explain why a hard browser refresh (fresh page load, fresh query) also fails to show "active" — a refresh bypasses any client-side reactivity issue entirely and re-evaluates the query from scratch. Since refresh also fails, the row itself must not exist / not match, ruling out a pure reactivity bug as the (sole) root cause.
  timestamp: 2026-07-10T00:17:00Z

## Evidence

- timestamp: 2026-07-10T00:05:00Z
  checked: app/[locale]/(marketing)/checkout/success/SuccessStatus.tsx
  found: Reactive Convex query `useQuery(convexQuery(api.subscriptions.getSubscription, {}))`; shows loading until either data.status === "active" or an 18s timeout elapses (CONFIRMATION_TIMEOUT_MS). No polling; relies on Convex websocket push. This matches the reported "still coming" (loading) then presumably "timeout" state.
  implication: Component logic itself is correct per its own D-09/D-10/D-11 design; the bug must be upstream (webhook never wrote / row never matches).

- timestamp: 2026-07-10T00:07:00Z
  checked: convex/subscriptions.ts getSubscription and upsertSubscription
  found: getSubscription derives clerkUserId strictly from ctx.auth.getUserIdentity().subject (no client-supplied id, correct per CR-01 IDOR fix). upsertSubscription requires args.clerkUserId to be present (else logs an anomaly and returns early without writing) and dedupes by stripeEventId via processedStripeEvents.
  implication: If session.metadata.clerkUserId were ever missing, the row would silently never be created (return {anomaly:...}), which would also match the symptom — but this requires the webhook to have fired at all, which is the next thing to verify.

- timestamp: 2026-07-10T00:09:00Z
  checked: app/api/webhooks/stripe/route.ts
  found: Verifies Stripe-Signature via stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET); on any verification failure returns 400 "Invalid signature" WITHOUT ever calling the Convex action — no subscriptions row write is attempted in that case. This failure is silent to the end user (Stripe-side webhook call, not a browser-visible network request).
  implication: If the wrong STRIPE_WEBHOOK_SECRET is configured (e.g., a stale/CLI secret vs. the currently active `stripe listen` session's secret, or vice versa), every webhook delivery attempt would 400 silently and the row would never be written — consistent with "even a refresh doesn't fix it."

- timestamp: 2026-07-10T00:12:00Z
  checked: .env.local (variable names and non-secret values only)
  found: APP_URL=https://localhost:3000 (used to build Stripe's success_url AND is the origin the Stripe webhook endpoint must target). NEXT_PUBLIC_CONVEX_URL points at a `dev:` Convex deployment (frugal-echidna-922). Single STRIPE_WEBHOOK_SECRET value present (no separate CLI/staging/prod distinction visible in this file, matching STATE.md's noted blocker "Three webhook secrets needed... document separately per environment").
  implication: A localhost origin is not reachable by Stripe's servers directly. Real Stripe test-mode webhook delivery to this environment is only possible via `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (CLI forwarding) or a public tunnel — neither of which is guaranteed to be running just because the user completed a real checkout in the browser.

- timestamp: 2026-07-10T00:14:00Z
  checked: .planning/phases/03-checkout-flow-pricing-page/03-04-PLAN.md (manual test procedure, lines ~54-58)
  found: Explicitly documents this exact prerequisite: "The Phase 2 webhook forwarder must be running locally (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`)" and "Start the dev server (npm run dev) and, in a second terminal, the Stripe CLI forwarder: stripe listen --forward-to localhost:3000/api/webhooks/stripe."
  implication: The known, documented setup requirement for this exact manual test is a second terminal running `stripe listen`. If that terminal was not running (or was running with a webhook secret that doesn't match .env.local's STRIPE_WEBHOOK_SECRET) during the UAT session, the checkout.session.completed event never reaches (or is rejected by) the local webhook route, fully explaining the observed symptom including "refresh doesn't fix it" (the row genuinely does not exist).

## Resolution

root_cause: "The Convex `subscriptions` row was never written because the `checkout.session.completed` webhook event never successfully reached the local dev server's /api/webhooks/stripe route. Root cause is environmental/procedural, not a code defect: this local environment's APP_URL is https://localhost:3000, which Stripe's servers cannot reach directly — delivery requires `stripe listen --forward-to localhost:3000/api/webhooks/stripe` to be actively running (as documented in 03-04-PLAN.md's manual test setup) with a webhook secret matching .env.local's STRIPE_WEBHOOK_SECRET. If that CLI forwarder was not running, or was running with a mismatched/stale secret, every delivery attempt is either never sent or rejected with a silent 400 'Invalid signature' by app/api/webhooks/stripe/route.ts — in either case the row is never inserted, so no amount of waiting or refreshing the success page can ever show 'active', matching the exact reported symptom. All application code on both the write path (webhook route -> Convex action -> upsertSubscription) and the read path (SuccessStatus.tsx -> getSubscription query) was traced and found correct."
fix: ""
verification: ""
files_changed: []
