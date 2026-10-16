# Roadmap: Noetree

## Overview

Milestone v1.0 adds a Free/Pro subscription model and an AI credits metering system to Noetree. The build follows a strict dependency chain: schema and infrastructure first, webhook handler second (sole writer of subscription state), checkout and pricing third (triggers the webhook), plan enforcement fourth (reads the state phases 1-3 establish), AI credits fifth (builds on the webhook's credit rows), and a settings page last (read-only aggregation of all prior state). Each phase is independently verifiable before the next begins.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Schema + Infrastructure Foundation** - Convex tables deployed, env vars configured, packages installed (completed 2026-07-08)
- [x] **Phase 2: Webhook Handler + Convex Internal Mutations** - Stripe events processed, subscription state written atomically (completed 2026-07-08)
- [x] **Phase 3: Checkout Flow + Pricing Page** - Users can view plans and subscribe via Stripe Checkout (completed 2026-07-10)
- [x] **Phase 4: Plan Enforcement** - Free tier note limit enforced server-side, upgrade prompts shown (completed 2026-07-10)
- [x] **Phase 5: AI Credits System** - Credits deducted atomically, top-up available, balance visible (completed 2026-07-10)
- [x] **Phase 6: Settings Page** - Users can manage subscription and credits from a single in-app page (completed 2026-07-11)

## Phase Details

### Phase 1: Schema + Infrastructure Foundation

**Goal**: All infrastructure prerequisites are in place — Convex tables deployed, secrets configured for all environments, and stub modules compiling — so subsequent phases build on a stable foundation without schema-deploy failures.
**Depends on**: Nothing (first phase)
**Requirements**: (prerequisite for all 19 — no direct requirement ownership; PLAN-05 monthly quota value baked into schema)
**Success Criteria** (what must be TRUE):

1. `convex dev` compiles without errors after schema additions (4 new tables: subscriptions, aiCredits, creditTransactions, processedStripeEvents)
2. All required env vars (STRIPE*SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, STRIPE_TOPUP_PRICE_ID, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) are present in local, staging, and production environments with no NEXT_PUBLIC* prefix on secrets
3. `stripe` and `@stripe/stripe-js` packages are installed and importable
4. Clerk middleware excludes `/api/webhooks/**` from authentication protection
5. Stub files for `convex/subscriptions.ts` and `convex/aiCredits.ts` compile and deploy cleanly
   **Plans**: 4 plans

Plans:

**Wave 1**

- [x] 01-01-PLAN.md — Convex schema (4 new tables + indexes) + typed stub files (convex/subscriptions.ts, convex/aiCredits.ts)
- [x] 01-02-PLAN.md — Install stripe/@stripe/stripe-js, bump @clerk/nextjs (CVE-2026-41248 fix), patch middleware.ts to exclude webhook routes
- [x] 01-03-PLAN.md — Document .env.example (D-04/D-05), create Stripe test-mode products/prices via API, capture real Price IDs (D-03)

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 01-04-PLAN.md — Propagate env vars to Vercel (local/staging/production) + create staging/production webhook secrets (SC-2 sign-off)

  **UI hint**: no

### Phase 2: Webhook Handler + Convex Internal Mutations

**Goal**: Stripe lifecycle events reliably update subscription state in Convex — the webhook handler is the single writer of all subscription and credit state, with idempotency protection and correct raw-body handling.
**Depends on**: Phase 1
**Requirements**: PAY-03, CRED-01
**Success Criteria** (what must be TRUE):

1. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` processes a test `checkout.session.completed` event and creates a subscriptions row in Convex with correct clerkUserId
2. Replaying the same Stripe event a second time produces no duplicate rows (processedStripeEvents idempotency guard active)
3. A test `invoice.paid` event with `billing_reason: subscription_cycle` resets the aiCredits balance to 100 in Convex
4. Webhook returns 200 for all 5 handled event types (checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed) and 400 for invalid signatures
5. Wrong webhook secret (simulated by changing env var) returns 400, never 500
   **Plans**: 6 plans

Plans:

**Wave 0**

- [x] 02-01-PLAN.md — Install Vitest/convex-test/@edge-runtime/vm test toolchain, add by_stripeSubscriptionId schema index (D-08), document INTERNAL_WEBHOOK_SECRET (D-02)

**Wave 1** _(blocked on Wave 0 completion)_

- [x] 02-02-PLAN.md — Implement convex/subscriptions.ts (upsertSubscription/deleteSubscription/markPastDue/getSubscription) with idempotent atomic writes
- [x] 02-03-PLAN.md — Implement convex/aiCredits.ts resetCredits (cross-table clerkUserId resolution via stripeSubscriptionId) + getCredits

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 02-04-PLAN.md — Create convex/stripeWebhooks.ts dispatcher action (shared-secret gate, event-type dispatch, billing_reason gate)

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 02-05-PLAN.md — Create app/api/webhooks/stripe/route.ts (signature verification, checkout.session.completed enrichment, status-code mapping)

**Wave 4** _(blocked on Wave 3 completion)_

- [x] 02-06-PLAN.md — Propagate INTERNAL_WEBHOOK_SECRET to all environments + manual end-to-end Stripe CLI sign-off

  **UI hint**: no

### Phase 3: Checkout Flow + Pricing Page

**Goal**: A visitor can view the pricing page showing Free and Pro plans, click Upgrade, complete payment via Stripe Checkout, and receive in-app confirmation that their Pro subscription is active.
**Depends on**: Phase 2
**Requirements**: PLAN-01, PAY-01, PAY-02
**Success Criteria** (what must be TRUE):

1. User can navigate to `/pricing` and see Free (free, max 20 notes) and Pro (9€/month, unlimited notes + 100 AI credits/month) plan comparison
2. Clicking "Upgrade to Pro" redirects to Stripe Checkout with the correct Pro price and clerkUserId in both `session.metadata` and `subscription_data.metadata`
3. After completing payment in Stripe test mode, user lands on a success page that shows "Subscription active" once the Phase 2 webhook has confirmed the Convex subscriptions row
4. Completing checkout twice with the same email reuses the existing Stripe customer (no duplicate customer records)
   **Plans**: 7 plans (2 gap-closure)

Plans:

**Wave 1**

- [x] 03-01-PLAN.md — Foundation: jsdom + shadcn badge, APP_URL env, Pricing/CheckoutSuccess i18n, 4 RED Wave 0 test scaffolds
- [x] 03-05-PLAN.md — Root-layout decomposition: extract app shell into (app) route group + move authenticated routes, leaving a chrome-free root so the (marketing) shell renders without AppSidebar/Header (D-01/D-04)

**Wave 2** _(blocked on Wave 1)_

- [x] 03-02-PLAN.md — Pricing page (PLAN-01) + createCheckoutSession Server Action with customer reuse, active short-circuit, dual clerkUserId metadata (PAY-01)
- [x] 03-03-PLAN.md — Success confirmation page (PAY-02): RSC auth() boundary + reactive SuccessStatus with loading/timeout/confirmed states

**Wave 3** _(blocked on Wave 2)_

- [x] 03-04-PLAN.md — End-to-end manual Stripe test-mode sign-off (SC2/SC3/SC4: redirect, webhook confirmation, no duplicate customer)
      **UI hint**: yes

**Gap Closure** _(from 03-HUMAN-UAT.md — Test 2 & Test 3 failures)_

- [x] 03-06-PLAN.md — Diagnosability fixes: guard+log the Convex auth-handshake/query in actions.ts (distinguishable error), console.error the real error in page.tsx's catch, log webhook 400/500 failures in route.ts (Wave 1, autonomous)
- [x] 03-07-PLAN.md — Manual UAT re-verification of Test 2 & Test 3 with `stripe listen` running and STRIPE_WEBHOOK_SECRET synced (Wave 2, depends on 03-06, checkpoint)

### Phase 4: Plan Enforcement

**Goal**: The Free tier note limit is enforced server-side in Convex mutations — Free users cannot exceed 20 notes regardless of client-side state, and they are shown a clear upgrade prompt when they hit the limit or try to access Pro features.
**Depends on**: Phase 3
**Requirements**: PLAN-02, PLAN-03, PLAN-04
**Success Criteria** (what must be TRUE):

1. A Free tier user's 21st `createNote` mutation is rejected by Convex with an error — the note is not created even if the client bypasses UI checks
2. A Pro tier user can create note 21, 50, and 200 without any rejection
3. A user with no subscriptions row (pre-existing user) is treated as Free tier — the 20-note limit applies
4. When a Free user hits the note limit, an upgrade prompt appears in the UI with a clear CTA to the pricing page
   **Plans**: 4 plans

Plans:

**Wave 1**

- [x] 04-01-PLAN.md — Server-side note-limit enforcement: isProUser helper + createNote 20-note gate (NOTE_LIMIT_REACHED) + convex-test coverage (PLAN-02, PLAN-03)
- [x] 04-02-PLAN.md — Upgrade-modal infrastructure: UpgradeModalProvider/useUpgradeModal + UpgradeModal Dialog + (app) layout mount + PlanEnforcement i18n (PLAN-04)

**Wave 2** _(blocked on Wave 1)_

- [x] 04-03-PLAN.md — Wire both createNote onError handlers (useNoteMutations.ts + notes/page.tsx) to open the modal on NOTE_LIMIT_REACHED (PLAN-04)

**Wave 3** _(blocked on Wave 2)_

- [x] 04-04-PLAN.md — End-to-end human verification of SC1-SC4 in the running app (checkpoint)

  **UI hint**: yes

### Phase 5: AI Credits System

**Goal**: Pro users have a visible AI credits balance that is atomically deducted when AI features are used, can be topped up via a one-time Stripe purchase, and automatically resets each billing cycle.
**Depends on**: Phase 4
**Requirements**: CRED-02, CRED-03, CRED-04, PAY-05
**Success Criteria** (what must be TRUE):

1. Using an AI feature (summary, suggestion, or generation) deducts exactly 1 credit from the user's balance — two concurrent AI calls do not both succeed when only 1 credit remains (atomic TOCTOU protection)
2. The remaining AI credits balance is visible near AI feature entry points in the app (not only in Settings)
3. A user with 0 credits cannot trigger an AI action — the action is blocked and a top-up prompt is shown
4. Clicking "Buy 50 credits for 2€" opens a Stripe Checkout in `payment` mode; after completion the balance increases by 50 and the purchase appears in credit transaction history
5. Credits reset to 100 automatically when the Phase 2 `invoice.paid` webhook fires for a billing cycle renewal
   **Plans**: 5 plans

Plans:

**Wave 1**

- [x] 05-01-PLAN.md — Credit deduction machinery: implement deductCredit + public runAiAction (TOCTOU-safe deduct/act/refund) + identity-derived getMyCredits + "refund" schema literal + convex-test (CRED-04, CRED-02)
- [x] 05-03-PLAN.md — Top-up Server Action (payment-mode, Pro-only gate) + CreditsExhaustedDialog (branching CTA) + AiCredits i18n (CRED-03, PAY-05)

**Wave 2** _(blocked on Wave 1)_

- [x] 05-02-PLAN.md — Top-up webhook: addCredits internalMutation (idempotent +50) + stripeWebhooks session.mode branch + convex-test (PAY-05)
- [x] 05-04-PLAN.md — Editor toolbar: Sparkles AiActionButton + reactive CreditsBalanceBadge + runAiAction wiring + CreditsExhaustedDialog mount (CRED-02, CRED-04)

**Wave 3** _(blocked on Wave 2)_

- [x] 05-05-PLAN.md — Automated security verification (IDOR/Pro-gate grep + full suite) + human UAT of SC1-SC5 (checkpoint)

  **UI hint**: yes

### Phase 6: Settings Page

**Goal**: Users can view and manage their entire subscription and credits state from a single in-app settings page — current plan, renewal date, upgrade or cancel actions, credit balance, and top-up history.
**Depends on**: Phase 5
**Requirements**: SET-01, SET-02, SET-03, SET-04, SET-05, PAY-04
**Success Criteria** (what must be TRUE):

1. Settings page shows current plan (Free or Pro), and if Pro, the subscription renewal date and status (active / cancelling at period end)
2. A Free user sees an "Upgrade to Pro" CTA in settings that initiates the checkout flow from Phase 3
3. A Pro user can click "Cancel subscription" and confirm in a dialog — after Stripe API call the status shows "cancels on [date]" without immediate loss of Pro access
4. Cancelled subscription correctly downgrades to Free after `customer.subscription.deleted` webhook fires at period end (Convex state reflects new plan)
5. User can view current AI credits balance and a history of top-up purchases with dates and amounts
   **Plans**: 5 plans

Plans:

**Wave 1**

- [x] 06-01-PLAN.md — listMyTopups identity-derived Convex query + tests (SET-05)
- [x] 06-02-PLAN.md — cancelSubscription/resumeSubscription Server Actions + tests (SET-04, PAY-04)
- [x] 06-03-PLAN.md — Settings NavUser dropdown item + Settings i18n namespace (SET-01)

**Wave 2** _(blocked on Wave 1)_

- [x] 06-04-PLAN.md — Settings page: stacked Plan Card + Credits Card composing all Wave 1 outputs (SET-01/02/03/05, wires SET-04/PAY-04)

**Wave 3** _(blocked on Wave 2)_

- [x] 06-05-PLAN.md — Automated security/suite gate + human UAT of SC1-SC5 (checkpoint)

  **UI hint**: yes

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6

| Phase                                          | Plans Complete | Status   | Completed  |
| ---------------------------------------------- | -------------- | -------- | ---------- |
| 1. Schema + Infrastructure Foundation          | 4/4            | Complete | 2026-07-08 |
| 2. Webhook Handler + Convex Internal Mutations | 6/6            | Complete | 2026-07-08 |
| 3. Checkout Flow + Pricing Page                | 7/7            | Complete | 2026-07-10 |
| 4. Plan Enforcement                            | 4/4            | Complete | 2026-07-10 |
| 5. AI Credits System                           | 5/5            | Complete | 2026-07-10 |
| 6. Settings Page                               | 5/5            | Complete | 2026-07-11 |

### Phase 06.1: Close gap: PLAN-05/CRED-01/CRED-04 — grant initial AI credits at Pro checkout (INSERTED)

**Goal:** A brand-new Pro subscriber is granted their full 100-credit AI quota at the moment `checkout.session.completed` (subscription mode) confirms — closing the v1.0 milestone-audit BLOCKER where new Pro users saw a 0/null balance and hit `INSUFFICIENT_CREDITS` on their first AI action until the next monthly renewal.
**Requirements**: PLAN-05, CRED-01, CRED-04
**Depends on:** Phase 6
**Plans:** 1/1 plans complete

Plans:

**Wave 1**

- [x] 06.1-01-PLAN.md — grantInitialCredits internalMutation (reset-to-100, collision-safe idempotency key) + wire into checkout.session.completed subscription branch + regression/replay/re-subscription tests (PLAN-05, CRED-01, CRED-04)
