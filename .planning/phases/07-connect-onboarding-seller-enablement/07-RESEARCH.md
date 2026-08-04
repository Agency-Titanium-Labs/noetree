# Phase 7: Connect Onboarding & Seller Enablement - Research

**Researched:** 2026-08-01
**Domain:** Stripe Connect (Express) seller onboarding + capability-gated server enforcement, added to an existing Next.js 15 + Convex + Clerk + Stripe (non-Connect) SaaS
**Confidence:** HIGH

## Summary

This phase adds Stripe Connect Express seller onboarding to an app that already has a working, well-tested non-Connect Stripe integration (subscriptions + AI-credit top-ups). Nothing new needs to be installed — Connect (Accounts, Account Links, capability fields) is part of the `stripe` Node SDK already in `package.json` (`22.3.0` installed, `22.4.0` current on npm — optional patch bump only). The work is entirely: (1) a new `connectAccounts` Convex table mirroring the existing `subscriptions` table's shape and idempotency discipline, (2) two new Next.js server actions (`createConnectOnboardingLink`, mirroring `pricing/actions.ts`'s auth-then-Stripe-call pattern), (3) a **second, distinct Stripe webhook endpoint** scoped to connected-account events (`connect: true` on the Stripe API/Dashboard side, a **separate** signing secret, a **separate** Next.js route) whose existence is the single most important infrastructure decision in this phase, and (4) a `SettingsSellerCard` component that is structurally a near-copy of `SettingsPlanCard`/`SettingsCreditsCard`.

The two pitfalls CONTEXT.md flags as directly in scope are both about trusting the wrong signal: (a) treating Stripe's onboarding `return_url` redirect as proof a seller can transact — it is only a navigation event, never authoritative; (b) assuming connected-account events (`account.updated`) arrive at the existing platform webhook endpoint — they do not, Stripe delivers them only to an endpoint explicitly registered with `connect: true` (or "Listen to events on Connected accounts" in the Dashboard/Workbench UI) and signs them with a **different** secret than `STRIPE_WEBHOOK_SECRET`. Both pitfalls are mechanically avoidable by following patterns this codebase already uses correctly elsewhere (webhook-driven grants only, distinct per-purpose secrets, idempotency via `processedStripeEvents`).

**Primary recommendation:** Build `connectAccounts` as a `subscriptions`-shaped table fed exclusively by a second, `connect`-scoped webhook endpoint (new route `app/api/webhooks/stripe-connect/route.ts`, new secret `STRIPE_CONNECT_WEBHOOK_SECRET`, new Convex file `connectAccounts.ts` with an `account.updated` handler), gate every future sell-side mutation through one new internal query (`isSellerActive`), and never derive seller-enabled state from the onboarding return-URL redirect.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Onboarding entry point**

- **D-01:** Add a "Become a seller" card to the Settings page now (alongside `SettingsPlanCard`/`SettingsCreditsCard`), visible to all users (Free + Pro) immediately — not gated behind Phase 8's listing flow. Phase 8 can later add a second entry point from "List for sale" that reuses the same underlying action.
- **D-02:** Clicking "Become a seller" goes straight to Stripe's hosted onboarding (create Express account + Account Link + redirect) — no in-app confirmation dialog first. Stripe's own hosted flow already covers ToS acceptance.

**Seller status card UX**

- **D-03:** The status card shows a color-coded badge (Pending / Active / Restricted — same visual pattern as `SettingsPlanCard`'s plan badge) plus exactly one contextual action: "Resume onboarding" when pending, no extra action when active, "Update details" (fresh Stripe-hosted link) when restricted. Not a detailed `charges_enabled`/`payouts_enabled` breakdown.
- **D-04:** The card shows onboarding status only in this phase — no payouts/earnings info. Earnings view is explicitly Phase 11 (HIST-02); keep Phase 7 scope tight.

**Restricted-account visibility**

- **D-05:** Account regression from active to restricted (Stripe requests more info later) surfaces Settings-only via the status card — no app-wide banner or notification. Matches the existing pattern where subscription `past_due` is also Settings-only with no toast/banner.
- **D-06:** Build a reusable server-side gate now (an internal query, e.g. `isSellerActive` / `getConnectAccountStatus`) that Phase 8 and Phase 9 will call directly to enforce CONNECT-03, instead of each later phase writing its own query against `connectAccounts`. Keeps the authoritative charges_enabled/payouts_enabled check in one place.

**Onboarding link retry/expiry**

- **D-07:** Never persist or reuse a Stripe Account Link URL client-side. Every "Continue/Resume onboarding" click calls `stripe.accountLinks.create` fresh and redirects immediately — this sidesteps Account Link expiry entirely; no "link expired" error state is needed.
- **D-08:** After the seller returns from Stripe's hosted onboarding (`return_url`), do not show an optimistic "verifying" state. The status card reflects only the webhook-synced `connectAccounts` row (starts as Pending by default). This directly avoids the research's Pitfall 1 — treating the onboarding-redirect as proof of capability instead of the authoritative `charges_enabled`/`payouts_enabled` state from the account object.

### Claude's Discretion

None — all four discussed areas reached explicit user decisions (no "you decide" selections).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. (Earnings/payout display was explicitly discussed and confirmed deferred to Phase 11/HIST-02, not a new idea — see D-04.)

## Phase Requirements

| ID         | Description                                                                                 | Research Support                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONNECT-01 | User can start Stripe Connect (Express) onboarding when creating their first listing        | D-01/D-02 scope this to a Settings-page entry point in Phase 7 (Phase 8 adds the "first listing" trigger reusing the same action); Pattern 1 (Account creation + Account Link) below covers the mechanics. |
| CONNECT-02 | Seller sees onboarding/payout status (pending, active, restricted) in Settings              | Pattern 2 (`SettingsSellerCard` + `connectAccounts` schema) below; D-03/D-04/D-05 constrain the exact UI states shown.                                                                                     |
| CONNECT-03 | Listing creation and checkout are blocked server-side until charges_enabled/payouts_enabled | D-06's reusable `isSellerActive` internal query (Pattern 4 below), called defensively by this phase's own nothing-yet-exists boundary and consumed by Phase 8/9.                                           |

## Project Constraints (from CLAUDE.md)

- This project uses Convex as its backend. **Always read `convex/_generated/ai/guidelines.md` first** before writing Convex code — read directly in this research session (see Sources); its rules override training-data assumptions about Convex APIs.
- Key guideline rules that apply to this phase's Convex work:
  - `query`/`mutation`/`action` = public API; `internalQuery`/`internalMutation`/`internalAction` = private, callable only from other Convex functions. `isSellerActive` (D-06) must be an `internalQuery` if Phase 8/9 call it only from their own mutations/actions, or `query` if a client component needs to read it directly — this phase's own `SettingsSellerCard` needs a **public** query to read the seller's own status reactively (mirrors `getSubscription`), so plan for both: a public `getMyConnectStatus` (client-facing, identity-derived) and an internal `isSellerActive`/`getConnectAccountStatus` (server-to-server gate for Phase 8/9).
  - ALWAYS include argument validators (`v.string()`, etc.) for every Convex function.
  - Do NOT use `.filter()` in queries — define an index and use `withIndex`.
  - `ctx.auth.getUserIdentity()` — never accept a `clerkUserId`/`userId` argument for authorization purposes on any public query; derive it server-side (established repo-wide via CR-01, re-confirmed in `subscriptions.ts`/`aiCredits.ts`).
  - Testing: `convex-test` + `vitest` + `@edge-runtime/vm`, test files inside `convex/`, `import.meta.glob` module map — already configured in this repo (`vitest.config.ts`, `convex/*.test.ts`).

## Architectural Responsibility Map

| Capability                                                       | Primary Tier                                                 | Secondary Tier        | Rationale                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start Connect onboarding (create Express account + Account Link) | API / Backend (Next.js Server Action)                        | —                     | Requires the Stripe secret key; must never run client-side. Mirrors existing `createCheckoutSession` in `pricing/actions.ts`.                                                                 |
| Redirect to Stripe-hosted onboarding UI                          | Browser / Client                                             | API / Backend         | The server action returns/redirects to a Stripe-hosted URL; Stripe (not this app) renders the onboarding form.                                                                                |
| Persist Connect account id + capability state                    | Database / Storage (Convex)                                  | —                     | New `connectAccounts` table, written only by webhook-driven internal mutations — never by the client or by the return-URL redirect handler.                                                   |
| Sync `charges_enabled`/`payouts_enabled` from Stripe             | API / Backend (Convex webhook dispatcher)                    | Database / Storage    | A second, Connect-scoped webhook endpoint (`app/api/webhooks/stripe-connect/route.ts`) receives `account.updated`, forwards to a new Convex internal mutation that patches `connectAccounts`. |
| Display seller status (badge + contextual action)                | Browser / Client (React component)                           | API / Backend (query) | `SettingsSellerCard` reads a reactive Convex query (`getMyConnectStatus`); no client-side derivation of status from any Stripe object.                                                        |
| Enforce "seller must be active" before listing/checkout          | API / Backend (Convex internal query, called from mutations) | —                     | D-06: single reusable server-side gate (`isSellerActive`); must be re-checked at the point of every sell-side action in Phase 8/9, never trusted from client state or cached in the browser.  |

## Standard Stack

### Core

| Library             | Version                                                        | Purpose                                                                                                                                                                                                               | Why Standard                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stripe` (Node SDK) | `22.3.0` installed / `22.4.0` current [VERIFIED: npm registry] | `stripe.accounts.create({ type: "express" })`, `stripe.accountLinks.create({ type: "account_onboarding", ... })`, webhook signature verification (`stripe.webhooks.constructEvent`) for the new Connect-scoped secret | Same package the existing subscription/top-up integration already uses; Connect Accounts v1, Account Links, and account-capability fields are part of its existing API surface — no new dependency. [CITED: STACK.md, verified against Context7 `/stripe/stripe-node` during milestone research] |

No new production dependency is required for this phase. `npm install stripe@22.4.0` is an optional patch bump only (verify against changelog before bumping mid-milestone; not required to unblock this phase).

### Supporting

| Library      | Version | Purpose | When to Use                                                                                                                                                                                                                           |
| ------------ | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none new)_ | —       | —       | Everything in this phase (Account creation, Account Links, webhook handling, Settings UI) is achievable with `stripe`, `convex`, `@clerk/nextjs`, and the existing shadcn/ui `Card`/`Badge`/`Button` components already in this repo. |

### Alternatives Considered

| Instead of                                             | Could Use                                                             | Tradeoff                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Express connected accounts                             | Standard or Custom connected accounts                                 | Standard assumes sellers already run a Stripe-powered business (poor fit — any Free/Pro user can casually become a seller); Custom requires building bespoke KYC UI and taking on compliance responsibility neither this phase nor milestone budgets for. [CITED: STACK.md] |
| Account Links (redirect to Stripe-hosted onboarding)   | `@stripe/connect-js` + `@stripe/react-connect-js` embedded onboarding | Embedded components avoid a redirect but add an iframe/session-token backend endpoint and a second SDK. D-02 explicitly locks the redirect-based flow — do not introduce embedded Connect components this phase. [CITED: STACK.md]                                          |
| One unified webhook route branching on `event.account` | Two fully separate Next.js routes, one per secret                     | Both are valid; this research (and Pitfall 2) recommends two separate routes for this phase specifically because it makes the secret-per-endpoint boundary impossible to blur — see Pattern 3 below.                                                                        |

**Installation:**

```bash
# No new dependency required. Optional patch bump:
npm install stripe@22.4.0
```

**Version verification:** `npm view stripe version` returned `22.4.0` [VERIFIED: npm registry] on 2026-08-01, confirming the currently installed `22.3.0` is not stale in a way that blocks Connect work — Connect Accounts v1, Account Links, and `application_fee_amount`/`transfer_data` (needed later in Phase 9, not this phase) are present in both versions per the SDK's published type surface (STACK.md, Context7-verified during milestone research).

## Package Legitimacy Audit

No external packages are being newly installed in this phase — Stripe Connect functionality rides entirely on the `stripe` package already present in `package.json` (installed and in use since the v1.0 milestone's non-Connect Stripe integration). The Package Legitimacy Gate protocol therefore has nothing new to audit.

| Package  | Registry | Age                 | Downloads | Source Repo                   | slopcheck                | Disposition                                                  |
| -------- | -------- | ------------------- | --------- | ----------------------------- | ------------------------ | ------------------------------------------------------------ |
| `stripe` | npm      | Years (established) | Very high | github.com/stripe/stripe-node | Not run (no new install) | Already approved — pre-existing dependency, no action needed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Seller (browser)
    |
    | 1. Click "Become a seller" (Settings page)
    v
Next.js Server Action  createConnectOnboardingLink()  [app/[locale]/(app)/settings/connect-actions.ts]
    |
    | 2a. auth() -> Clerk userId; getToken({template:"convex"}) -> authenticate Convex call
    | 2b. ConvexHttpClient query: does a connectAccounts row already exist for this user?
    v
Convex query  connectAccounts.getMyConnectStatus  (or internal lookup)
    |
    | 3. If no row: stripe.accounts.create({ type: "express", metadata: { clerkUserId } })
    |    (Stripe account id NOT yet stored in Convex here -- stored only via the
    |     first account.updated webhook OR an explicit "record pending account" mutation --
    |     see Open Questions for which of these two orderings this phase should pick)
    | 4. stripe.accountLinks.create({ account, type: "account_onboarding", refresh_url, return_url })
    v
redirect(accountLink.url)
    |
    v
Stripe-hosted onboarding (KYC, bank details -- entirely Stripe UI, zero app code)
    |
    | 5. Stripe redirects browser back to return_url
    |    (NOT proof of completion -- Pitfall 1 -- no optimistic UI per D-08)
    v
Settings page (SettingsSellerCard) -- shows "Pending" (unchanged, webhook-driven only)
    |
    | (asynchronously, whenever Stripe verifies/re-verifies the account)
    v
Stripe fires `account.updated`
    |
    v
app/api/webhooks/stripe-connect/route.ts   (NEW, distinct route + distinct secret)
    |
    | 6. stripe.webhooks.constructEvent(rawBody, sig, STRIPE_CONNECT_WEBHOOK_SECRET)
    | 7. forward verified event to Convex via ConvexHttpClient + INTERNAL_WEBHOOK_SECRET
    v
Convex action  connectAccounts.processConnectWebhookEvent  (NEW, mirrors stripeWebhooks.ts shape)
    |
    | 8. case "account.updated": read event.account, event.data.object.charges_enabled/
    |    payouts_enabled/details_submitted/requirements
    v
Convex internal mutation  connectAccounts.upsertFromStripeAccount
    |
    | 9. idempotency check against processedStripeEvents (own key, NOT shared with platform events)
    | 10. upsert connectAccounts row keyed by clerkUserId (found via stored stripeAccountId -> clerkUserId,
    |     or via account.metadata.clerkUserId on the event payload itself)
    v
connectAccounts table (Convex, reactive)
    |
    v
SettingsSellerCard (useQuery, reactive) -- badge flips Pending -> Active/Restricted automatically, no polling

-------------------------------------------------------------------------------
Later (Phase 8 / Phase 9), a separate synchronous path:

Listing-creation / Checkout-creation mutation or action
    |
    v
ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId })   <-- D-06 gate
    |
    +-- charges_enabled && payouts_enabled === true --> proceed
    |
    +-- otherwise --> throw ConvexError("CONNECT_ONBOARDING_REQUIRED")
```

### Recommended Project Structure

```
convex/
├── schema.ts                       # MODIFIED: add connectAccounts table
├── connectAccounts.ts              # NEW: getMyConnectStatus (public query), isSellerActive
│                                    #      (internal query, D-06 gate), upsertFromStripeAccount
│                                    #      (internal mutation), processConnectWebhookEvent (action)
└── connectAccounts.test.ts         # NEW: mirrors subscriptions.test.ts pattern

app/
├── [locale]/(app)/settings/
│   ├── page.tsx                    # MODIFIED: add <SettingsSellerCard />
│   └── connect-actions.ts          # NEW: "use server" — createConnectOnboardingLink()
└── api/webhooks/
    ├── stripe/route.ts             # UNCHANGED — platform events only, existing secret
    └── stripe-connect/route.ts     # NEW — connect-scoped events only, NEW secret

components/
└── SettingsSellerCard.tsx          # NEW — mirrors SettingsPlanCard.tsx structurally
```

### Pattern 1: Express account creation + Account Link, created fresh every click (D-07)

**What:** `createConnectOnboardingLink()` is a `"use server"` action that (a) authenticates via Clerk `auth()`, (b) looks up any existing `connectAccounts` row for this user via an authenticated Convex query, (c) creates a Stripe Express account only if none exists yet (`stripe.accounts.create({ type: "express", metadata: { clerkUserId } })`), (d) **always** creates a brand-new `stripe.accountLinks.create({ type: "account_onboarding", account, refresh_url, return_url })` regardless of whether the account is new or returning, and (e) redirects to `accountLink.url`. This exactly matches D-07 ("never persist or reuse a Stripe Account Link URL client-side").

**When to use:** Every "Become a seller" / "Resume onboarding" / "Update details" click (D-03's three contextual actions all funnel through this same action — the label differs, the underlying call does not).

**Example (illustrative, follows `pricing/actions.ts`'s exact auth+Convex-lookup+Stripe-call shape):**

```typescript
// app/[locale]/(app)/settings/connect-actions.ts
"use server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createConnectOnboardingLink(
  locale: string,
): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const convexToken = await getToken({ template: "convex" });
  if (convexToken) convex.setAuth(convexToken);

  const existing = await convex.query(
    api.connectAccounts.getMyConnectStatus,
    {},
  );

  let stripeAccountId = existing?.stripeAccountId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      metadata: { clerkUserId: userId },
    });
    stripeAccountId = account.id;
    // NOTE (Open Question below): must decide whether to record this
    // pending stripeAccountId in Convex here (via a public mutation the
    // client is authenticated for) BEFORE the first webhook arrives, or
    // rely solely on account.metadata.clerkUserId inside the webhook to
    // discover it. D-08 forbids an optimistic "verifying" UI state but
    // does NOT forbid persisting the raw account id — those are different
    // concerns. Recommend persisting stripeAccountId immediately (status:
    // "pending") so the webhook has a row to patch by index, rather than
    // scanning by account.metadata on every account.updated event.
  }

  const baseUrl = process.env.APP_URL!;
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    type: "account_onboarding",
    refresh_url: `${baseUrl}/${locale}/settings`,
    return_url: `${baseUrl}/${locale}/settings`,
  });

  redirect(accountLink.url);
}
```

**Trade-offs:**

- Pro: sidesteps Account Link expiry entirely (locked decision D-07); one code path serves "start," "resume," and "update details."
- Con: the very first `accounts.create` call happens synchronously inside the server action, not from a webhook — this is the one place in the whole Connect flow where Convex state is written (or at least referenced) outside the webhook-driven-grants-only rule (Anti-Pattern 2 in ARCHITECTURE.md). This is safe **only** because it stores an inert account id with `status: "pending"`, never a capability flag — `charges_enabled`/`payouts_enabled` still come exclusively from the webhook. Flagged as an Open Question below for the planner to lock down precisely (which mutation, what initial status value, whether it's public or goes through an internal-only path).

### Pattern 2: `connectAccounts` schema mirrors `subscriptions`

**What:** New Convex table, same shape/index discipline as `subscriptions`:

```typescript
connectAccounts: defineTable({
  clerkUserId: v.string(),
  stripeAccountId: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("active"),
    v.literal("restricted"),
  ),
  chargesEnabled: v.boolean(),
  payoutsEnabled: v.boolean(),
  detailsSubmitted: v.boolean(),
}).index("by_clerkUserId", ["clerkUserId"])
  .index("by_stripeAccountId", ["stripeAccountId"]),
```

`status` is a derived/denormalized convenience field (D-03 needs exactly three UI states: Pending/Active/Restricted) computed from `chargesEnabled && payoutsEnabled` (-> `active`) vs. `detailsSubmitted && !(chargesEnabled && payoutsEnabled)` (-> `restricted`, i.e. submitted but Stripe still blocking) vs. neither (-> `pending`). Store both the raw booleans (for the D-06 gate, which should check the raw `chargesEnabled`/`payoutsEnabled` fields directly, not the derived `status` string, to avoid a second place the "active" definition can drift) and the derived status (for the card's badge).

**When to use:** Single source of truth for every seller's Connect state, written only by `upsertFromStripeAccount` (webhook-driven).

**Trade-offs:**

- Pro: identical index shape to `subscriptions` (`by_clerkUserId`) means `getMyConnectStatus`/`isSellerActive` are structurally identical to `getSubscription` — low risk, easy review.
- Con: needs a second index (`by_stripeAccountId`) that `subscriptions` doesn't have, because the webhook's `account.updated` event identifies the account by `event.account` (a Stripe account id), not directly by `clerkUserId` — the handler must resolve `event.account` -> `clerkUserId` via this index (falling back to `event.data.object.metadata.clerkUserId` only if no row exists yet, per the Pattern 1 Open Question above).

### Pattern 3: Second, distinctly-secured webhook endpoint for Connect events (Pitfall 2)

**What:** Register a **new** Stripe webhook endpoint scoped to connected-account events — via Dashboard/Workbench ("Create an event destination" -> enter the endpoint URL -> click "Listen to events on Connected accounts" -> select `account.updated` at minimum) or via the API with `connect: true`:

```bash
curl https://api.stripe.com/v1/webhook_endpoints \
  -u sk_test_...: \
  -d url="https://<app-origin>/api/webhooks/stripe-connect" \
  -d "events[]"="account.updated" \
  -d connect=true
```

[CITED: docs.stripe.com/connect/webhooks] This produces a **distinct signing secret**, stored as a new env var `STRIPE_CONNECT_WEBHOOK_SECRET` (never reuse `STRIPE_WEBHOOK_SECRET`). Build a **new** Next.js route `app/api/webhooks/stripe-connect/route.ts` that is a near-verbatim copy of the existing `app/api/webhooks/stripe/route.ts` (same 400-vs-500 signature-verification-then-forward-to-Convex shape) but verifies against `STRIPE_CONNECT_WEBHOOK_SECRET` and forwards to a **new** Convex action (`connectAccounts.processConnectWebhookEvent`), not the existing `stripeWebhooks.processWebhookEvent`.

Connect-scoped events carry a top-level `account` field (e.g. `"account": "acct_1234567890"`) [CITED: docs.stripe.com/connect/webhooks] that platform events never have — this is a routing signal only, never an authenticity signal (authenticity comes exclusively from successful signature verification against the correct per-endpoint secret).

**When to use:** This phase, before considering onboarding-sync "done." This is infrastructure every later marketplace payment feature (Phase 8's listing gate, Phase 9's checkout gate) depends on.

**Trade-offs:**

- Pro: two fully separate routes/secrets/dispatcher-actions makes the secret-per-endpoint boundary structurally impossible to blur (no `if (event.account)` branching logic that could silently accept a wrongly-signed event) — matches the "single unified route" Anti-Pattern flagged as risky in PITFALLS.md's Technical Debt Patterns table.
- Con: duplicates ~40 lines of signature-verification/error-mapping boilerplate between `route.ts` and `stripe-connect/route.ts`. Acceptable per PITFALLS.md's own guidance — do not extract a shared helper prematurely if it obscures which secret verified which request; a straight copy is fine at this scale.

**Live verification requirement (explicit research flag, not optional):**

```bash
# Terminal 1 — forward BOTH platform and connect-scoped events locally:
stripe listen --forward-to localhost:3000/api/webhooks/stripe \
              --forward-connect-to localhost:3000/api/webhooks/stripe-connect

# Terminal 2 — after completing a real (test-mode) Express onboarding flow
# and getting a real acct_... id, trigger a connect-scoped event against it:
stripe trigger --stripe-account acct_xxx account.updated
```

[CITED: docs.stripe.com/connect/webhooks — CLI trigger/forward-connect-to usage confirmed via WebSearch cross-referencing the Stripe CLI wiki] Confirm the event actually reaches `stripe-connect/route.ts` (check terminal logs / a temporary `console.log(event.account)`), not just that `stripe listen`'s own CLI output shows the event being sent — a known GitHub issue (stripe/stripe-cli#1089, filed 2023, still open with no confirmed resolution as of this research) reports that combining `--load-from-webhooks-api` with `--forward-connect-to` can silently fail to deliver connect events locally even though the Dashboard shows the listener as active. **Do not use `--load-from-webhooks-api`** for this phase's local verification — use the plain `stripe listen --forward-to ... --forward-connect-to ...` form (which creates its own ephemeral CLI-managed test endpoints rather than loading real ones), which is the form documented as working in the official Connect webhooks guide.

### Pattern 4: Reusable server-side gate (D-06)

**What:** One `internal` Convex query, e.g.:

```typescript
export const isSellerActive = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    return account?.chargesEnabled === true && account?.payoutsEnabled === true;
  },
});
```

Phase 8's `listings.createListing` mutation and Phase 9's checkout-creation action both call this (via `ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId })`) and throw `ConvexError("CONNECT_ONBOARDING_REQUIRED")` if false — never trusting a client-supplied "I'm an active seller" flag.

**When to use:** Every future sell-side gate (CONNECT-03, and by extension LIST-01's "can list" check and BUY-01's "can this listing's seller receive payment" check in later phases).

**Trade-offs:**

- Pro: single authoritative definition of "seller active," reusable, easy to unit test in isolation this phase even though nothing calls it yet.
- Con: this phase has no caller for it yet (Phase 8/9 don't exist) — write it now per D-06, and add a direct unit test (`connectAccounts.test.ts`) asserting the true/false boundary against `chargesEnabled`/`payoutsEnabled` combinations, since there's no integration-level caller to exercise it against yet.

### Anti-Patterns to Avoid

- **Deriving "seller enabled" from the onboarding `return_url` redirect (Pitfall 1 / Anti-Pattern 2 in ARCHITECTURE.md):** the redirect is a navigation event, not proof of verification — a user can hit "back," close the tab, or Stripe's async review can still be pending. All capability state must originate from the `account.updated` webhook, never from `return_url` handler logic. D-08 already locks this UX decision; the research reinforces it's also a **security-relevant correctness** requirement, not just a UX preference.
- **Reusing the existing platform webhook route/secret for Connect events, or branching on `event.account` inside the existing single dispatcher:** either silently drops every Connect event (wrong endpoint scope) or fails every signature check (wrong secret). See Pattern 3.
- **Checking `charges_enabled`/`payouts_enabled` via a live `stripe.accounts.retrieve` call on every Settings-page render:** slow, risks Stripe rate limits under any real traffic. Cache in Convex, refreshed only via the webhook (PITFALLS.md Performance Traps table).
- **Treating "onboarding done once" as a permanent flag:** Stripe accounts can regress from active to restricted later (e.g., a re-requested document). The `connectAccounts` row must be re-patched on every `account.updated`, and D-05 already specifies this regression is visible (Settings-only, no banner) — the underlying data model must actually support "flip back to restricted," not just "flip to active once."

## Don't Hand-Roll

| Problem                                            | Don't Build                                                             | Use Instead                                                                                        | Why                                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seller identity verification / KYC                 | A custom document-upload + review flow                                  | Stripe Express hosted onboarding (Account Links)                                                   | Stripe already maintains this UI and its regulatory compliance; building a custom flow (Custom accounts) was explicitly rejected in STACK.md for this milestone.     |
| Onboarding-status polling                          | A client-side interval that calls `stripe.accounts.retrieve` repeatedly | Webhook-driven Convex row + `useQuery` reactivity                                                  | Convex already gives free real-time updates once the webhook patches the row — no polling needed, matches existing `SettingsPlanCard`/`SettingsCreditsCard` pattern. |
| Idempotency bookkeeping for the new webhook stream | A new ad-hoc "already handled this connect event" table                 | The existing `processedStripeEvents` table, with a distinct key scheme (see Common Pitfalls below) | Reuses proven infra; only the key discipline needs attention, not a new table.                                                                                       |

**Key insight:** Every piece of this phase has a near-identical precedent already built and tested in this repo (`subscriptions.ts` for the table shape, `pricing/actions.ts` for the server-action shape, `stripeWebhooks.ts`/`route.ts` for the webhook dispatch shape, `SettingsPlanCard.tsx` for the UI shape). The work is disciplined copying with two deliberate deviations: a second webhook secret/route, and the `by_stripeAccountId` index needed to resolve `event.account` back to a user.

## Common Pitfalls

### Pitfall 1: Onboarding-redirect treated as proof of capability

**What goes wrong:** A seller finishes Stripe's hosted form, lands back on `/settings` via `return_url`, and the app (or a well-meaning developer) shows "You're now a seller!" or silently flips a flag at that moment.
**Why it happens:** The redirect is the most visible, synchronous signal in the whole flow — it's tempting to treat it as "done."
**How to avoid:** D-08 already locks this: no optimistic "verifying" state, the card only ever reflects the webhook-synced `connectAccounts` row, which defaults to `pending` and is only ever patched by `upsertFromStripeAccount` (webhook-triggered).
**Warning signs:** Any code path that reads `searchParams` on the `/settings` return-URL redirect and uses it to set seller status, even transiently.

### Pitfall 2: Connect webhook events silently never arrive

**What goes wrong:** New `account.updated` handling is wired into the existing `stripeWebhooks.processWebhookEvent` switch, pointed at by the existing single Stripe webhook endpoint. Events never arrive (0 retries, 0 errors — total silence), because Stripe only delivers connected-account events to an endpoint explicitly registered with `connect: true`.
**Why it happens:** From inside application code, "another event type in the switch" looks sufficient — the endpoint-scope requirement is invisible from the code, only visible in Stripe's Dashboard/API configuration.
**How to avoid:** Register the second endpoint (Pattern 3), verify locally with `stripe listen --forward-connect-to` + `stripe trigger --stripe-account`, confirm delivery with real logs before considering the phase done — not just that the code compiles.
**Warning signs:** Only one webhook endpoint exists in the Stripe Dashboard/Workbench; no code path reads `event.account`; `STRIPE_CONNECT_WEBHOOK_SECRET` is unset or identical to `STRIPE_WEBHOOK_SECRET`.

### Pitfall 3: Idempotency key collision with the existing `processedStripeEvents` table

**What goes wrong:** The new Connect event stream has its own `event.id` sequence, distinct from platform events, but if `upsertFromStripeAccount`'s idempotency check reuses the bare `stripeEventId` the same way `subscriptions.upsertSubscription` does, there's no _cross-stream_ collision risk (different id namespaces) — but there IS a risk if this phase's webhook handler ever needs to trigger more than one independent mutation off a single `account.updated` event (e.g., updating `connectAccounts` AND, in a hypothetical future extension, sending a notification) without giving each its own suffixed key, repeating the exact bug class already fixed once in Phase 06.1 (`grantInitialCredits` vs `upsertSubscription`).
**Why it happens:** Copy-pasting the single-mutation idempotency pattern without considering a second consumer of the same event later.
**How to avoid:** This phase only needs one consumer (`upsertFromStripeAccount`) per `account.updated` event, so a bare `stripeEventId` key is safe **for this phase specifically** — but document this explicitly in the code so a future phase doesn't add a second consumer of the same event without remembering to suffix its own key (`${event.id}:<operation>`), per the project's own established precedent.
**Warning signs:** A future PR adds logic inside the same `account.updated` case that calls a second `internalMutation` sharing the same bare event id for its own idempotency check.

### Pitfall 4: Resolving `event.account` back to a `clerkUserId`

**What goes wrong:** `account.updated` events identify the Stripe account (`event.account` = `"acct_..."`) but not the app's user directly. If the `connectAccounts` row for that `stripeAccountId` doesn't exist yet (e.g., the very first `account.updated` fires before the server action's own bookkeeping write, if any, has landed), the handler has no row to patch and must not silently drop the event.
**Why it happens:** Webhook delivery and the synchronous server-action flow race — Stripe can fire `account.updated` almost immediately after `accounts.create`, potentially before the app has finished its own request/response cycle.
**How to avoid:** Fall back to `event.data.object.metadata.clerkUserId` (set at `accounts.create` time per Pattern 1) to _insert_ a new row when no existing `by_stripeAccountId` match is found, rather than only ever patching. Treat "no matching row and no metadata.clerkUserId" as a logged anomaly (matching the existing `{ anomaly: ... }` return style in `stripeWebhooks.ts`), not a thrown/uncaught error (which would 500 to Stripe and trigger pointless retries for a request Stripe will keep sending regardless).
**Warning signs:** `upsertFromStripeAccount` only ever does `ctx.db.patch` (never `ctx.db.insert`), silently no-oping when the row doesn't exist yet.

## Code Examples

### `account.updated` internal mutation (idempotent upsert, mirrors `subscriptions.upsertSubscription`)

```typescript
// convex/connectAccounts.ts
export const upsertFromStripeAccount = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeAccountId: v.string(),
    clerkUserId: v.optional(v.string()), // from event.data.object.metadata, fallback only
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) return { alreadyProcessed: true };

    const status =
      args.chargesEnabled && args.payoutsEnabled
        ? ("active" as const)
        : args.detailsSubmitted
          ? ("restricted" as const)
          : ("pending" as const);

    const existing = await ctx.db
      .query("connectAccounts")
      .withIndex("by_stripeAccountId", q =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        chargesEnabled: args.chargesEnabled,
        payoutsEnabled: args.payoutsEnabled,
        detailsSubmitted: args.detailsSubmitted,
        status,
      });
    } else if (args.clerkUserId) {
      // Pitfall 4: first-ever event racing the server action's own write.
      await ctx.db.insert("connectAccounts", {
        clerkUserId: args.clerkUserId,
        stripeAccountId: args.stripeAccountId,
        chargesEnabled: args.chargesEnabled,
        payoutsEnabled: args.payoutsEnabled,
        detailsSubmitted: args.detailsSubmitted,
        status,
      });
    } else {
      console.error(
        `upsertFromStripeAccount anomaly: no existing row and no clerkUserId metadata for stripeAccountId ${args.stripeAccountId}`,
      );
      return { anomaly: "no matching account and no clerkUserId metadata" };
    }

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { success: true };
  },
});
```

Source: pattern derived directly from `convex/subscriptions.ts:upsertSubscription` (read in this research session) with the `by_stripeAccountId` fallback-insert branch added per Pitfall 4 above — not copied from any external doc.

## State of the Art

| Old Approach                                   | Current Approach                                                        | When Changed                       | Impact                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Connect Accounts v1 (`type: 'express'`) | Stripe Connect Accounts v2 (unified configuration-based Account object) | GA'd Q2 2026 per Stripe's own docs | Not adopted this phase — Stripe explicitly states existing v1 integrations don't need to migrate, and mature Checkout-Session-with-v2-config guidance was not confirmed as mature during milestone research (STACK.md). Build this phase on v1 Express, matching the rest of the app's existing v1-style Stripe usage (Customers, Subscriptions). Re-evaluate v2 in a later milestone. |

**Deprecated/outdated:** None specific to this phase's scope (Account creation, Account Links, `account.updated` webhook) — all confirmed current via Stripe's official docs fetched during this research session (2026-08-01).

## Assumptions Log

| #   | Claim                                                                                                                                                                                                                                                               | Section                   | Risk if Wrong                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Persisting `stripeAccountId` to Convex immediately after `stripe.accounts.create` (before any webhook fires), tagged `status: "pending"`, is safe and does not violate the "grants only from webhooks" rule — because it stores an inert id, not a capability flag. | Pattern 1 (Open Question) | If the planner disagrees and requires the row to be created _only_ by the webhook, the `event.account` -> `clerkUserId` resolution (Pitfall 4) becomes the sole mechanism and must rely entirely on `metadata.clerkUserId`, which is a reasonable but distinct design choice the planner should explicitly pick, not inherit implicitly.                                                                                                               |
| A3  | `connectAccounts.clerkUserId` is keyed on `identity.subject`, an intentional deviation from `convex/_generated/ai/guidelines.md`'s stated preference for `identity.tokenIdentifier` as the global identity key.                                                     | Pattern 1 / plan 07-01    | Consistent with the existing `subscriptions.ts` and `aiCredits.ts` precedent in this repo, so a Connect row joins cleanly to those tables. Migrating all three tables to `tokenIdentifier` is a cross-cutting decision out of scope for this phase; if it ever happens, `connectAccounts` must migrate in the same change or the join breaks.                                                                                                          |
| A2  | The three-way `status` derivation (`active` iff both booleans true; `restricted` iff `detailsSubmitted` true but not both capability flags; otherwise `pending`) matches what D-03's badge needs.                                                                   | Pattern 2                 | Stripe's actual state machine also exposes `requirements.disabled_reason` and `requirements.currently_due`, which could produce a more nuanced "restricted" definition (e.g. distinguishing "under review" from "action needed"). D-03 explicitly says the card does NOT need a detailed breakdown, so this three-way simplification is likely sufficient, but it is this research's inference, not a value Stripe returns directly as a single field. |

## Open Questions (RESOLVED)

All three questions were closed during phase planning (2026-08-01). Each carries an inline
**RESOLVED** note naming the plan and task that implements the resolution.

1. **Exact write-timing for the initial `stripeAccountId` record (Pattern 1)**
   - What we know: D-07 forbids persisting/reusing _Account Link URLs_ client-side; it says nothing about the Stripe _Account id_ itself. The webhook-driven-grants-only rule (Anti-Pattern 2, ARCHITECTURE.md) governs _capability_ state, not the existence of an inert account-id row.
   - What's unclear: Whether the planner wants `createConnectOnboardingLink()` to write a `status: "pending"` row itself (via a new public mutation, e.g. `connectAccounts.recordPendingAccount`) immediately after `stripe.accounts.create`, or whether it should rely solely on the first `account.updated` webhook (which typically fires almost immediately after account creation) to create the row via the `metadata.clerkUserId` fallback path (Pitfall 4).
   - Recommendation: Have the server action write the pending row itself (Assumption A1) — it's simpler, avoids a race where the Settings page shows "no seller account yet" for a few seconds after the redirect has already happened, and doesn't violate D-08 (D-08 is about not showing an optimistic _verifying/active_ state, not about whether a pending row exists at all).
   - **RESOLVED (plan 07-02, Task 1):** Recommendation adopted. `connectAccounts.recordPendingAccount` is a public, identity-derived mutation that writes an inert `status: "pending"` row with all three capability booleans `false`, called by `createConnectOnboardingLink` (plan 07-04) immediately after `stripe.accounts.create`. The webhook fallback path (Pitfall 4) is kept as well — `upsertFromStripeAccount` still inserts from `metadata.clerkUserId` when no row exists — so both orderings are safe. Assumption A1 is therefore locked in, not left open.

2. **Where `refresh_url` should point vs. `return_url`**
   - What we know: Account Links require both `refresh_url` (used if the link itself expires/is invalid — Stripe redirects here so the app can generate a fresh one) and `return_url` (used when the seller completes or exits the flow normally).
   - What's unclear: D-07 says every click creates a fresh link, which sidesteps expiry for the _initial_ click — but Stripe can still redirect to `refresh_url` mid-flow for other reasons (e.g., session issues on Stripe's side). This phase's `/settings` page is a reasonable target for both, but the planner should confirm both should point to the same `/settings` URL (simplest, and consistent with D-07's "always regenerate" philosophy) rather than a dedicated intermediate route.
   - Recommendation: Point both `refresh_url` and `return_url` at `/${locale}/settings` — the Settings page already re-derives all UI state reactively from Convex, so there's no meaningful difference in landing on the same page either way.
   - **RESOLVED (plan 07-04, Task 1):** Recommendation adopted. Both `refresh_url` and `return_url` are built as `${baseUrl}/${safeLocale}/settings`, where `safeLocale` is allow-listed against `routing.locales` with `routing.defaultLocale` as fallback (threat T-07-14). A unit test asserts the two URLs are string-equal and that a traversal input collapses to `/en/settings`. No dedicated intermediate route is introduced.

3. **Live-verification blocker risk (stripe/stripe-cli#1089)**
   - What we know: The official `stripe listen --forward-to ... --forward-connect-to ...` (without `--load-from-webhooks-api`) pattern is documented as the standard local-testing approach and is expected to work.
   - What's unclear: Whether this specific project's Stripe CLI version/setup is affected by the open GitHub issue's failure mode (which involved the `--load-from-webhooks-api` flag specifically, not the base `--forward-connect-to` flag).
   - **RESOLVED (plan 07-06, Task 3):** Live verification is a blocking `checkpoint:human-verify` with explicit steps requiring an observed `[200]` forward line to `/api/webhooks/stripe-connect` in the `stripe listen` terminal — the CLI's event list alone is rejected as evidence (threat T-07-23). The task's `read_first` points at this question, and its `resume-signal` instructs the developer to apply the fallback below (rather than declaring the phase blocked) if step 7 produces no forward line. Evidence is recorded in `07-LIVE-VERIFICATION.md`.
   - Recommendation / fallback: If local live-verification via `stripe listen --forward-connect-to` + `stripe trigger --stripe-account` does not deliver events during implementation, fall back to registering a real (test-mode) Connect-scoped Dashboard endpoint pointed at a tunneled localhost URL (e.g. via `stripe listen --forward-to` is itself already a tunnel, so this fallback is really: skip the CLI's ephemeral-endpoint mode and use `--load-from-webhooks-api` against a manually pre-registered test endpoint, or use a tool like `ngrok` + a real Dashboard-registered endpoint) before concluding the phase is blocked — do not skip live verification silently.

## Environment Availability

| Dependency                          | Required By                                                                                                                                 | Available                                                                                                                                           | Version                                                       | Fallback                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe CLI (`stripe`)               | Local webhook forwarding/testing (`stripe listen`, `stripe trigger`)                                                                        | Not verified in this research session — assumed present since PROJECT.md states prior phases already used it for platform-webhook live verification | —                                                             | If absent, install per Stripe's official CLI docs before starting implementation; this phase cannot be considered complete without live webhook verification (explicit research flag). |
| `stripe` npm package                | All Connect API calls                                                                                                                       | ✓                                                                                                                                                   | `22.3.0` installed, `22.4.0` current [VERIFIED: npm registry] | —                                                                                                                                                                                      |
| Stripe Dashboard access (test mode) | Registering the second Connect-scoped webhook endpoint, enabling Connect on the account, confirming Express is available as an account type | Not verifiable from this environment — requires the developer's own Stripe Dashboard login                                                          | —                                                             | None — this is a one-time manual configuration step that must happen before `stripe.accounts.create({ type: 'express' })` will succeed at all.                                         |

**Missing dependencies with no fallback:**

- Stripe Dashboard one-time configuration (enabling Connect, confirming Express account type availability) — cannot be automated or verified from this research session; the planner must include a `checkpoint:human-verify` or explicit setup task for this.

**Missing dependencies with fallback:**

- Stripe CLI local testing — if unavailable, the Dashboard-registered-endpoint + tunnel fallback described in Open Question 3 applies.

## Validation Architecture

### Test Framework

| Property           | Value                                                           |
| ------------------ | --------------------------------------------------------------- |
| Framework          | Vitest `^4.1.10` + `convex-test` `^0.0.54` + `@edge-runtime/vm` |
| Config file        | `vitest.config.ts` (repo root)                                  |
| Quick run command  | `npx vitest run convex/connectAccounts.test.ts`                 |
| Full suite command | `npm run test:unit` (= `vitest run`)                            |

### Phase Requirements → Test Map

| Req ID                | Behavior                                                                                                                                       | Test Type                                                                                                              | Automated Command                                                                                                                                                         | File Exists?                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| CONNECT-01            | `createConnectOnboardingLink` creates an Express account only once (idempotent on repeat calls), always generates a fresh Account Link         | integration (server action logic — Stripe calls need mocking or a dedicated integration test against Stripe test mode) | No existing Next.js server-action test harness in this repo (`pricing/actions.ts`/`settings/actions.ts` have no `.test.ts` counterpart) — this is a Wave 0 gap, see below | ❌ Wave 0                                                                                   |
| CONNECT-02            | `getMyConnectStatus` returns null for signed-out, returns the caller's own row (never another user's) for signed-in                            | unit                                                                                                                   | `npx vitest run convex/connectAccounts.test.ts -t "getMyConnectStatus"`                                                                                                   | ❌ Wave 0                                                                                   |
| CONNECT-02            | `upsertFromStripeAccount` is idempotent on replayed `stripeEventId` (mirrors `subscriptions.test.ts`'s existing idempotency test pattern)      | unit                                                                                                                   | `npx vitest run convex/connectAccounts.test.ts -t "idempotent"`                                                                                                           | ❌ Wave 0                                                                                   |
| CONNECT-02            | Status regression (active -> restricted) correctly re-patches an existing row, not just first-write                                            | unit                                                                                                                   | `npx vitest run convex/connectAccounts.test.ts -t "regress"`                                                                                                              | ❌ Wave 0                                                                                   |
| CONNECT-03            | `isSellerActive` returns false for pending/restricted/nonexistent accounts, true only when both `chargesEnabled` and `payoutsEnabled` are true | unit                                                                                                                   | `npx vitest run convex/connectAccounts.test.ts -t "isSellerActive"`                                                                                                       | ❌ Wave 0                                                                                   |
| CONNECT-01/02 (infra) | Connect-scoped webhook actually reaches `stripe-connect/route.ts` and is correctly dispatched                                                  | manual (Stripe CLI live-verify)                                                                                        | `stripe listen --forward-connect-to ... && stripe trigger --stripe-account acct_xxx account.updated`                                                                      | ❌ Wave 0 — explicitly flagged as required before considering the phase done, not skippable |

### Sampling Rate

- **Per task commit:** `npx vitest run convex/connectAccounts.test.ts`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`, AND the manual Stripe CLI live-verification (`stripe listen --forward-connect-to` + `stripe trigger --stripe-account`) must be performed and its output/log confirmed by whoever executes this phase — this is not satisfied by unit tests alone, per the explicit research flag inherited from SUMMARY.md.

### Wave 0 Gaps

- [ ] `convex/connectAccounts.test.ts` — covers CONNECT-02, CONNECT-03 (mirrors `convex/subscriptions.test.ts` structure exactly: idempotency test, identity-derived query test, regression test)
- [ ] No existing pattern in this repo for testing `"use server"` action files (`connect-actions.ts`) — `pricing/actions.ts` and `settings/actions.ts` have zero test coverage today; this phase should either (a) accept the same gap consistent with existing project precedent, or (b) be the phase that introduces the first action-level test (e.g. via mocking `stripe` and `ConvexHttpClient`). Flag for the planner to decide explicitly — this research does not find an existing convention to copy.
- [ ] `STRIPE_CONNECT_WEBHOOK_SECRET` env var — must be added to `.env.example` (mirroring the existing `STRIPE_WEBHOOK_SECRET` documentation block) and set locally before any live verification can run.
- [ ] Manual live-verification checklist (Stripe CLI) — not automatable in CI; must be a documented manual step in the phase's own verification artifact.

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                                                                                                                                                                 |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication     | yes     | Clerk `auth()` in the server action (existing pattern); no new auth mechanism introduced                                                                                                                         |
| V3 Session Management | no      | No new session concept — reuses existing Clerk session + Convex token handshake pattern                                                                                                                          |
| V4 Access Control     | yes     | `clerkUserId` derived exclusively from `ctx.auth.getUserIdentity()` in all public Convex queries — never accepted as a client argument (CR-01 precedent, re-applied here for `getMyConnectStatus`)               |
| V5 Input Validation   | yes     | Convex `v.*` argument validators on every function; webhook payload fields (`charges_enabled`, `payouts_enabled`, etc.) read defensively (optional chaining, anomaly-return pattern) rather than trusted blindly |
| V6 Cryptography       | yes     | Stripe webhook signature verification (`stripe.webhooks.constructEvent`) — never hand-rolled, uses the SDK's built-in HMAC verification exactly as the existing `route.ts` already does                          |

### Known Threat Patterns for Stripe Connect onboarding

| Pattern                                                                                      | STRIDE                                                                                                                                               | Standard Mitigation                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook payload spoofing (forged `account.updated` claiming `charges_enabled: true`)         | Tampering / Spoofing                                                                                                                                 | `stripe.webhooks.constructEvent` signature verification against `STRIPE_CONNECT_WEBHOOK_SECRET`, exactly mirroring the existing platform route's 400-on-bad-signature behavior |
| Connect event misdelivery/misrouting to the wrong secret (Pitfall 2)                         | Tampering (accepting an unverifiable event)                                                                                                          | Two fully separate routes/secrets (Pattern 3) — no shared-secret fallback logic that could accept an incorrectly-signed event                                                  |
| IDOR: one user reading/writing another user's `connectAccounts` row via a client-supplied id | Elevation of Privilege / Information Disclosure                                                                                                      | `getMyConnectStatus` derives `clerkUserId` from `ctx.auth.getUserIdentity()` only, never a client argument (V4 above)                                                          |
| Trusting the onboarding `return_url` redirect as proof of capability (Pitfall 1)             | Spoofing (a user could reach `return_url` without ever completing verification, or even without Stripe's involvement at all if the URL is guessable) | All capability state changes originate exclusively from the signature-verified webhook, never from the return-URL page's own logic                                             |
| Replay of a captured webhook payload                                                         | Tampering / Repudiation                                                                                                                              | Existing `processedStripeEvents` idempotency table, keyed by `stripeEventId`, applied identically to the new Connect event stream                                              |

## Sources

### Primary (HIGH confidence)

- Direct repo inspection (this session): `.planning/phases/07-connect-onboarding-seller-enablement/07-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`, `convex/subscriptions.ts`, `convex/stripeWebhooks.ts`, `convex/stripeWebhooks.test.ts`, `convex/subscriptions.test.ts`, `convex/aiCredits.ts`, `convex/schema.ts`, `convex/_generated/ai/guidelines.md`, `app/api/webhooks/stripe/route.ts`, `app/[locale]/(app)/settings/page.tsx`, `app/[locale]/(app)/settings/actions.ts`, `app/[locale]/(marketing)/pricing/actions.ts`, `components/SettingsPlanCard.tsx`, `components/SettingsCreditsCard.tsx`, `components/ui/badge.tsx`, `package.json`, `vitest.config.ts`, `.env.example`
- `.planning/research/SUMMARY.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/STACK.md` — milestone-level research, previously Context7/official-docs-verified per their own Sources sections
- [Connect webhooks — Stripe Docs](https://docs.stripe.com/connect/webhooks) — fetched directly this session; confirmed `connect: true` API parameter, Dashboard "Listen to events on Connected accounts" flow, `event.account` field shape, distinct signing secret requirement, and `account.updated` field-checking best practice
- `npm view stripe version` — confirmed `22.4.0` current vs. `22.3.0` installed [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- WebSearch: "Stripe Dashboard register second webhook endpoint... account.updated" — cross-referenced against the official docs fetch above, consistent
- WebSearch: "stripe listen --forward-connect-to stripe trigger --stripe-account CLI testing Connect webhooks" — confirmed CLI command syntax, consistent with official docs and Stripe CLI wiki

### Tertiary (LOW confidence)

- [stripe/stripe-cli GitHub issue #1089](https://github.com/stripe/stripe-cli/issues/1089) — a single unresolved bug report (filed 2023, no confirmed fix as of this research) about `--load-from-webhooks-api` combined with `--forward-connect-to` failing to deliver events locally. Flagged as a possible live-verification obstacle (Open Question 3), not treated as a confirmed current-state fact — the base `--forward-connect-to` pattern (without `--load-from-webhooks-api`) is the documented, expected-to-work approach and is what this research recommends using.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependency, reuses an already Context7-verified SDK surface (milestone research) plus a fresh official-docs fetch this session for the Connect-webhook-specific mechanics.
- Architecture: HIGH — every pattern is grounded in a specific, directly-read file in this repo with a near-identical existing precedent (subscriptions.ts, pricing/actions.ts, route.ts, SettingsPlanCard.tsx).
- Pitfalls: HIGH for Pitfall 1/2 (both directly verified against official Stripe docs and this repo's existing webhook code this session); MEDIUM for the CLI live-verification caveat (single unresolved GitHub issue, not independently reproduced).

**Research date:** 2026-08-01
**Valid until:** 30 days (Stripe Connect v1 mechanics are stable; re-verify if implementation slips past early September 2026, particularly re-check whether Accounts v2 guidance has matured enough to reconsider)
