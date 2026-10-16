# Phase 7: Connect Onboarding & Seller Enablement - Pattern Map

**Mapped:** 2026-08-01
**Files analyzed:** 8 (2 modified, 6 new)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File                                                                      | Role                         | Data Flow                        | Closest Analog                                                                                                                                       | Match Quality |
| -------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `convex/schema.ts` (add `connectAccounts` table)                                       | model/config                 | CRUD                             | `convex/schema.ts` (`subscriptions` table def, lines 40-53)                                                                                          | exact         |
| `convex/connectAccounts.ts` — `getMyConnectStatus` (public query)                      | service/query                | request-response                 | `convex/subscriptions.ts` `getSubscription` (lines 4-19)                                                                                             | exact         |
| `convex/connectAccounts.ts` — `isSellerActive` (internal query, D-06 gate)             | service/query                | request-response                 | `convex/aiCredits.ts` `getCredits` (lines 59-71)                                                                                                     | exact         |
| `convex/connectAccounts.ts` — `upsertFromStripeAccount` (internal mutation)            | service/mutation             | event-driven                     | `convex/subscriptions.ts` `upsertSubscription` (lines 21-88)                                                                                         | exact         |
| `convex/connectAccounts.ts` — `processConnectWebhookEvent` (action, dispatcher)        | service/action               | event-driven                     | `convex/stripeWebhooks.ts` `processWebhookEvent` (lines 1-240)                                                                                       | exact         |
| `convex/connectAccounts.test.ts` (NEW)                                                 | test                         | CRUD/event-driven                | `convex/subscriptions.test.ts` (whole file)                                                                                                          | exact         |
| `app/[locale]/(app)/settings/connect-actions.ts` — `createConnectOnboardingLink` (NEW) | controller (server action)   | request-response                 | `app/[locale]/(marketing)/pricing/actions.ts` `createCheckoutSession` (lines 1-92) + `app/[locale]/(app)/settings/actions.ts` (auth-handshake shape) | exact         |
| `app/api/webhooks/stripe-connect/route.ts` (NEW)                                       | route/webhook                | event-driven                     | `app/api/webhooks/stripe/route.ts` (whole file)                                                                                                      | exact         |
| `components/SettingsSellerCard.tsx` (NEW)                                              | component                    | request-response (reactive read) | `components/SettingsPlanCard.tsx` (whole file) + `components/SettingsCreditsCard.tsx` (skip-sentinel query shape)                                    | exact         |
| `app/[locale]/(app)/settings/page.tsx` (MODIFIED — add `<SettingsSellerCard />`)       | component (page composition) | —                                | itself (lines 1-22)                                                                                                                                  | exact         |
| `.env.example` (MODIFIED — add `STRIPE_CONNECT_WEBHOOK_SECRET`)                        | config                       | —                                | `.env.example` `STRIPE_WEBHOOK_SECRET` block (lines 5-8)                                                                                             | exact         |

## Pattern Assignments

### `convex/schema.ts` — add `connectAccounts` table (model, CRUD)

**Analog:** `convex/schema.ts` lines 40-53 (`subscriptions` table)

**Core pattern to copy** (lines 40-53):

```typescript
subscriptions: defineTable({
  clerkUserId: v.string(),
  stripeCustomerId: v.string(),
  stripeSubscriptionId: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("canceled"),
    v.literal("past_due"),
  ),
  currentPeriodEnd: v.number(),
  cancelAtPeriodEnd: v.boolean(),
})
  .index("by_clerkUserId", ["clerkUserId"])
  .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),
```

**Apply as** (per RESEARCH.md Pattern 2 — note the SECOND index, `by_stripeAccountId`, which `subscriptions` does not need but `connectAccounts` does, because the webhook resolves accounts by `event.account`, not by `clerkUserId`):

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
})
  .index("by_clerkUserId", ["clerkUserId"])
  .index("by_stripeAccountId", ["stripeAccountId"]),
```

Also add to the SAME table set: `processedStripeEvents` (lines 74-78) is REUSED as-is — no new idempotency table (Pitfall 3 in RESEARCH.md: bare `stripeEventId` key is safe for this phase's single-consumer `account.updated` handler).

---

### `convex/connectAccounts.ts` — `getMyConnectStatus` (public query, request-response)

**Analog:** `convex/subscriptions.ts` `getSubscription` (lines 1-19)

**Imports pattern** (lines 1-2):

```typescript
import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
```

(For `connectAccounts.ts`, extend to `import { query, internalQuery, internalMutation, action } from "./_generated/server";` since the file needs all four exports plus `internal`/`ConvexError` per the action below.)

**Core identity-derived query pattern** (lines 4-19, copy near-verbatim):

```typescript
export const getSubscription = query({
  args: {},
  handler: async ctx => {
    // Security: clerkUserId is derived exclusively from the caller's
    // authenticated Convex identity (never a client-supplied argument) so a
    // signed-in user cannot read another user's subscription/billing status
    // by passing an arbitrary id (IDOR — found in 03-REVIEW.md CR-01).
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});
```

Apply identically for `getMyConnectStatus`, swapping table name to `connectAccounts`. This is the query `SettingsSellerCard` and `connect-actions.ts` both read from.

---

### `convex/connectAccounts.ts` — `isSellerActive` (internal query, D-06 gate, request-response)

**Analog:** `convex/aiCredits.ts` `getCredits` (lines 59-71)

**Core internalQuery pattern to copy** (lines 59-71):

```typescript
// Security: internal-only. Takes a caller-supplied clerkUserId, so it must
// never be reachable from the public client SDK — doing so would let any
// caller enumerate another user's credit balance (IDOR). Client-facing
// balance reads go through the identity-derived getMyCredits query below.
export const getCredits = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});
```

**Apply as** (per RESEARCH.md Pattern 4 — checks raw booleans, never the derived `status` string, to avoid a second place "active" can drift):

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

Same "internal-only, caller-supplied clerkUserId is safe here because it's never exposed to the public client SDK" security comment applies — carry it over.

---

### `convex/connectAccounts.ts` — `upsertFromStripeAccount` (internal mutation, event-driven)

**Analog:** `convex/subscriptions.ts` `upsertSubscription` (lines 21-88) and `markPastDue` (lines 135-176) for the by-secondary-index lookup shape

**Idempotency + patch-or-insert pattern to copy** (lines 21-88, full shape):

```typescript
export const upsertSubscription = internalMutation({
  args: {
    /* ... */
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) {
      return { alreadyProcessed: true };
    }

    if (!args.clerkUserId) {
      console.error(
        `upsertSubscription anomaly: missing clerkUserId for stripeEventId ${args.stripeEventId}`,
      );
      return { anomaly: "missing clerkUserId" };
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_clerkUserId", q =>
        q.eq("clerkUserId", args.clerkUserId as string),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        /* ... */
      });
    } else {
      await ctx.db.insert("subscriptions", {
        /* ... */
      });
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

**Deviation required (Pitfall 4):** unlike `upsertSubscription` (which looks up by `by_clerkUserId` and hard-fails to an anomaly if `clerkUserId` is missing), `upsertFromStripeAccount` must look up by `by_stripeAccountId` (Stripe's `account.updated` event identifies the account, not the user) and only fall back to `clerkUserId` (from `event.data.object.metadata.clerkUserId`) on the INSERT branch when no existing row is found — never patch-only. See RESEARCH.md's full code example (lines 425-493 of 07-RESEARCH.md) for the exact insert-vs-patch branching to copy; it is already written out in full there and should be copied near-verbatim rather than re-derived.

**Status derivation** (RESEARCH.md Pattern 2, A2 assumption): `active` iff `chargesEnabled && payoutsEnabled`; `restricted` iff `detailsSubmitted` true but not both flags; else `pending`.

---

### `convex/connectAccounts.ts` — `processConnectWebhookEvent` (action, event-driven dispatcher)

**Analog:** `convex/stripeWebhooks.ts` `processWebhookEvent` (lines 1-240)

**Shared-secret auth guard pattern to copy** (lines 29-39):

```typescript
export const processWebhookEvent = action({
  args: { event: v.any(), secret: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    if (args.secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
      // ConvexError (not a plain Error) is required here: Convex's documented
      // production behavior only preserves thrown data across the action
      // boundary for ConvexError — a plain Error's message gets redacted, which
      // would silently break route.ts's 400-vs-500 auth-failure mapping (CR-01).
      throw new ConvexError("Unauthorized: invalid INTERNAL_WEBHOOK_SECRET");
    }

    switch (args.event.type) {
      // ... case per event.type, each `return await ctx.runMutation(internal.X.Y, {...})`
      default:
        return { skipped: true };
    }
  },
});
```

**Apply as:** `processConnectWebhookEvent` needs only ONE case (`account.updated`) reading `event.account` (top-level field, only present on Connect-scoped events) plus `event.data.object.charges_enabled` / `.payouts_enabled` / `.details_submitted`, dispatching to `internal.connectAccounts.upsertFromStripeAccount`. Reuse the SAME `INTERNAL_WEBHOOK_SECRET` (not a new secret — this secret authenticates the Next.js-route-to-Convex-action hop, distinct from `STRIPE_CONNECT_WEBHOOK_SECRET` which authenticates Stripe-to-Next.js-route).

---

### `convex/connectAccounts.test.ts` (NEW test file)

**Analog:** `convex/subscriptions.test.ts` (whole file, 320 lines)

**Setup boilerplate to copy** (lines 1-11):

```typescript
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");
```

**Test shapes to mirror (one test per bullet):**

- Idempotency-on-replay (lines 42-79: `upsertSubscription is idempotent on replayed stripeEventId`) → adapt to `upsertFromStripeAccount is idempotent on replayed stripeEventId`.
- Identity-derived query, own-row-only (lines 141-170: `getSubscription returns null for a signed-in caller with no row` / `getSubscription returns null for an unauthenticated caller`) → adapt to `getMyConnectStatus`.
- Regression re-patch (new — not in `subscriptions.test.ts`, but directly implied by RESEARCH.md's anti-pattern "Treating onboarding-done as permanent": write an `active` row, then patch via a second `account.updated` payload with `chargesEnabled: false`, assert the row flips to `restricted`/`pending`).
- Anomaly-without-throw (lines 118-139: `upsertSubscription with a missing clerkUserId returns an anomaly sentinel without throwing and writes no row`) → adapt to the "no existing row and no clerkUserId metadata" anomaly path (Pitfall 4).
- Boundary-value unit test for `isSellerActive` (new — no direct analog since `subscriptions.ts` has no equivalent boolean-AND gate; write straightforward true/false table: both true → true; either false → false; no row → false).

**`withIdentity` pattern to copy** (line 32-34):

```typescript
const sub = await t
  .withIdentity({ subject: "user_1" })
  .query(api.subscriptions.getSubscription, {});
```

---

### `app/[locale]/(app)/settings/connect-actions.ts` — `createConnectOnboardingLink` (server action, request-response)

**Analog:** `app/[locale]/(marketing)/pricing/actions.ts` `createCheckoutSession` (lines 1-92), auth-handshake shape cross-checked against `app/[locale]/(app)/settings/actions.ts` `cancelSubscription` (lines 1-64)

**Imports pattern** (pricing/actions.ts lines 1-8):

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { redirect as localeRedirect, routing } from "@/i18n/routing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

**Auth + Clerk-to-Convex token handshake pattern to copy** (pricing/actions.ts lines 18-48):

```typescript
const { userId, redirectToSignIn, getToken } = await auth();
if (!userId) {
  redirectToSignIn({ returnBackUrl: `/${safeLocale}/pricing` });
  return;
}

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
let existing: Awaited<
  ReturnType<typeof convex.query<typeof api.subscriptions.getSubscription>>
>;
try {
  const convexToken = await getToken({ template: "convex" });
  if (convexToken) convex.setAuth(convexToken);
  existing = await convex.query(api.subscriptions.getSubscription, {});
} catch (err) {
  console.error(
    "createCheckoutSession: subscription lookup/auth handshake failed",
    err,
  );
  throw new Error("subscriptionLookupFailed");
}
```

Apply identically, swapping `api.subscriptions.getSubscription` for `api.connectAccounts.getMyConnectStatus`.

**Narrow try/catch around ONLY the Stripe API call, redirect() OUTSIDE the try** (pricing/actions.ts lines 56-91 — this is the critical shape: Pitfall 4 in `settings/actions.ts`'s comments explicitly warns `redirect()` must never be inside a try/catch that also wraps the Stripe call):

```typescript
let session: Stripe.Checkout.Session;
try {
  session = await stripe.checkout.sessions.create({
    /* ... */
  });
} catch (err) {
  console.error(
    "createCheckoutSession: stripe.checkout.sessions.create failed",
    err,
  );
  throw new Error("checkoutSessionCreationFailed");
}

if (session.url) {
  redirect(session.url);
}
```

Apply as: `stripe.accounts.create({ type: "express", metadata: { clerkUserId: userId } })` (only if no existing `stripeAccountId`) then, unconditionally, `stripe.accountLinks.create({ account, type: "account_onboarding", refresh_url, return_url })` — each in its own narrow try/catch, `redirect(accountLink.url)` outside both. See RESEARCH.md's full worked example (Pattern 1, lines 219-275 of 07-RESEARCH.md) for the exact account-creation-is-conditional-but-link-creation-is-always-fresh shape (D-07).

**metadata.clerkUserId sourcing convention** (pricing/actions.ts line 70, comment on line 68-69):

```typescript
// D-07 (locked Phase 1): clerkUserId sourced ONLY from auth() (T-03-02),
// written into both session.metadata and subscription_data.metadata.
metadata: { clerkUserId: userId },
```

Apply identically: `stripe.accounts.create({ type: "express", metadata: { clerkUserId: userId } })` — `userId` from `auth()` only, never client-supplied.

---

### `app/api/webhooks/stripe-connect/route.ts` (NEW route, event-driven)

**Analog:** `app/api/webhooks/stripe/route.ts` (whole file, 95 lines) — near-verbatim copy per RESEARCH.md Pattern 3 (deliberately NOT deduplicated with the existing route)

**Full pattern to copy** (lines 1-94, structure):

```typescript
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error(
      "[stripe webhook] signature verification failed (400) — check STRIPE_WEBHOOK_SECRET matches the active `stripe listen` session",
      err,
    );
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    await convex.action(api.stripeWebhooks.processWebhookEvent, {
      event,
      secret: process.env.INTERNAL_WEBHOOK_SECRET!,
    });
    return new Response(null, { status: 200 });
  } catch (err) {
    if (
      err instanceof ConvexError &&
      typeof err.data === "string" &&
      err.data.startsWith("Unauthorized")
    ) {
      return new Response("Unauthorized", { status: 400 });
    }
    console.error("[stripe webhook] processing failed (500)", err);
    return new Response("Webhook processing failed", { status: 500 });
  }
}
```

**Deviations for the Connect route:**

1. Verify against `process.env.STRIPE_CONNECT_WEBHOOK_SECRET!` (NOT `STRIPE_WEBHOOK_SECRET`).
2. Drop the `checkout.session.completed` / `subscriptionSnapshot` pre-processing block (lines 38-60 of the platform route) — irrelevant to `account.updated`.
3. Forward to `api.connectAccounts.processConnectWebhookEvent` (NOT `api.stripeWebhooks.processWebhookEvent`), still with `secret: process.env.INTERNAL_WEBHOOK_SECRET!` (same shared secret as the platform route — this secret is for the internal Next.js→Convex hop, unrelated to which Stripe secret verified the inbound signature).
4. Keep the exact 400-vs-500 mapping and the "never log rawBody/signature/any secret" discipline (lines 30, 90).

---

### `components/SettingsSellerCard.tsx` (NEW component, request-response reactive read)

**Analog:** `components/SettingsPlanCard.tsx` (whole file, 165 lines) for the badge+contextual-action shape; `components/SettingsCreditsCard.tsx` (lines 11-26) for the simpler skip-sentinel query shape

**Imports + skip-sentinel query pattern to copy** (SettingsPlanCard.tsx lines 1-42):

```typescript
"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPlanCard() {
  const t = useTranslations("Settings");
  const { isSignedIn } = useUser();

  // Pattern 3 / Pitfall 5: "skip" sentinel, never `enabled: false`.
  // Security: no clerkUserId arg — the query derives the caller's identity
  // from Convex auth itself (IDOR fix, 03-REVIEW.md CR-01).
  const { data: subscription, isPending: isSubscriptionPending } = useQuery(
    convexQuery(api.subscriptions.getSubscription, isSignedIn ? {} : "skip"),
  );
  ...
```

Apply identically: `useQuery(convexQuery(api.connectAccounts.getMyConnectStatus, isSignedIn ? {} : "skip"))`.

**Skeleton-while-pending pattern** (line 85, 95-97):

```typescript
const showSkeleton = isSignedIn && isSubscriptionPending;
...
{showSkeleton ? (
  <Skeleton className="h-6 w-40" />
) : ( /* content */ )}
```

**Contextual single-action pattern** (D-03 needs exactly one action per state — mirrors the `!isPro` / `isPro && !isCancelling` / `isPro && isCancelling` three-way branch, lines 103-132):

```typescript
{!isPro && (
  <Button asChild>
    <Link href="/pricing">{t("upgradeCta")}</Link>
  </Button>
)}

{isPro && !isCancelling && ( /* one state, one action */ )}

{isPro && isCancelling && ( /* another state, another action */ )}
```

Apply as three states keyed off `connectAccount?.status`: `pending` → "Resume onboarding" button calling `createConnectOnboardingLink`; `active` → no action; `restricted` → "Update details" button also calling `createConnectOnboardingLink` (D-03: same underlying action for both, per RESEARCH.md Pattern 1 — "the label differs, the underlying call does not").

**Server-action call + local pending/error state pattern** (lines 58-83):

```typescript
async function handleCancel() {
  setError(false);
  setIsPending(true);
  try {
    await cancelSubscription();
    setCancelDialogOpen(false);
  } catch (err) {
    console.error("cancelSubscription failed", err);
    setError(true);
  } finally {
    setIsPending(false);
  }
}
```

Apply as `handleOnboard()` calling `createConnectOnboardingLink(locale)` — note this action performs a `redirect()` server-side (never returns normally on success), so the try/catch here only ever fires on failure (e.g. Stripe API error) — no `finally`-driven UI reset needed on the success path since the browser navigates away.

**Color-coded badge:** No existing component in this repo currently renders shadcn's `<Badge>` for a status pill in Settings — `SettingsPlanCard.tsx` shows plan name as plain text, not a `<Badge>`. D-03 asks for "a color-coded badge... same visual pattern as `SettingsPlanCard`'s plan badge," but that literal badge doesn't exist as a component instance to copy from. Use `components/ui/badge.tsx` (already in the repo, lines 1-48) directly:

```typescript
import { Badge } from "@/components/ui/badge";
// variant="secondary" (pending, neutral) | variant="default" (active) | variant="destructive" (restricted)
<Badge variant={status === "active" ? "default" : status === "restricted" ? "destructive" : "secondary"}>
  {t(`seller${statusLabel}`)}
</Badge>
```

---

### `app/[locale]/(app)/settings/page.tsx` (MODIFIED — add card)

**Analog:** itself, current state (lines 1-22)

**Exact edit:**

```typescript
import SettingsSellerCard from "@/components/SettingsSellerCard";
// ...
<div className="space-y-8">
  <SettingsPlanCard />
  <SettingsCreditsCard />
  <SettingsSellerCard />
</div>
```

---

### `.env.example` (MODIFIED — add Connect webhook secret)

**Analog:** existing `STRIPE_WEBHOOK_SECRET` block (lines 5-8)

**Pattern to copy and adapt:**

```
# Stripe webhook signing secret — SECRET, server-only. DISTINCT value per environment.
# Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
# Staging/production: Stripe Dashboard -> Webhooks -> [endpoint] -> Signing secret.
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

Add immediately after it:

```
# Stripe CONNECT webhook signing secret — SECRET, server-only, DISTINCT from
# STRIPE_WEBHOOK_SECRET above. Registered separately with connect: true
# (Dashboard: "Listen to events on Connected accounts"). Never reuse the
# platform secret here — see RESEARCH.md Pitfall 2.
# Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe --forward-connect-to localhost:3000/api/webhooks/stripe-connect`.
# Staging/production: Stripe Dashboard -> Webhooks -> [connect-scoped endpoint] -> Signing secret.
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx
```

## Shared Patterns

### ConvexError for client-inspectable errors

**Source:** `convex/stripeWebhooks.ts` lines 33-39
**Apply to:** `processConnectWebhookEvent`'s `INTERNAL_WEBHOOK_SECRET` guard (identical to platform dispatcher); any error `connect-actions.ts` needs `SettingsSellerCard` to distinguish (per CONTEXT.md's "Established Patterns" note — ConvexError required, not plain Error, for anything the client must inspect).

```typescript
if (args.secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
  throw new ConvexError("Unauthorized: invalid INTERNAL_WEBHOOK_SECRET");
}
```

### Identity-derived clerkUserId (never client-supplied) for public queries

**Source:** `convex/subscriptions.ts` lines 7-12 (comment + `ctx.auth.getUserIdentity()`)
**Apply to:** `getMyConnectStatus` — the ONLY public-facing new query this phase adds. `isSellerActive` is internal and legitimately takes `clerkUserId` as an arg (mirrors `aiCredits.getCredits`) because it's never reachable from the public client SDK.

### Idempotency via `processedStripeEvents`

**Source:** `convex/subscriptions.ts` lines 37-45, 80-84 (check-then-insert bookend)
**Apply to:** `upsertFromStripeAccount` — reuse the SAME table, same bare `stripeEventId` key (Pitfall 3: safe because this phase has exactly one consumer per `account.updated` event; document this constraint in code per RESEARCH.md's explicit instruction).

### Webhook route 400-vs-500 error mapping

**Source:** `app/api/webhooks/stripe/route.ts` lines 24-36, 71-93
**Apply to:** `app/api/webhooks/stripe-connect/route.ts` — bad signature → 400 (never retried productively by Stripe); `ConvexError` with `.data` starting `"Unauthorized"` → 400; any other processing failure → 500 (retryable). Never log rawBody, signature, or any secret value.

### Server action: narrow try/catch around Stripe call only, redirect() outside

**Source:** `app/[locale]/(marketing)/pricing/actions.ts` lines 56-91 (comment "Pitfall 4: redirect() must never be inside this try/catch")
**Apply to:** `createConnectOnboardingLink` — critical for both the `stripe.accounts.create` and `stripe.accountLinks.create` calls; `redirect(accountLink.url)` must be the last statement, outside any try block.

### "skip" sentinel for signed-out reactive queries

**Source:** `components/SettingsPlanCard.tsx` line 41-42, `components/SettingsCreditsCard.tsx` lines 19-24
**Apply to:** `SettingsSellerCard`'s `useQuery(convexQuery(api.connectAccounts.getMyConnectStatus, isSignedIn ? {} : "skip"))` — never `enabled: false`.

## No Analog Found

None — every file in this phase has a direct, near-identical precedent already in the repo (per RESEARCH.md's own "Key insight": "Every piece of this phase has a near-identical precedent already built and tested in this repo").

The one partial gap: no existing component literally renders `<Badge>` for a Settings-page status pill (see `SettingsSellerCard.tsx` section above) — `components/ui/badge.tsx` exists and is unused elsewhere in Settings, so this is a "component exists, no usage precedent" gap rather than a missing pattern.

## Metadata

**Analog search scope:** `convex/`, `app/[locale]/(app)/settings/`, `app/[locale]/(marketing)/pricing/`, `app/api/webhooks/`, `components/`, `components/ui/`, `.env.example`
**Files scanned:** `convex/subscriptions.ts`, `convex/subscriptions.test.ts`, `convex/stripeWebhooks.ts`, `convex/aiCredits.ts`, `convex/schema.ts`, `app/api/webhooks/stripe/route.ts`, `app/[locale]/(app)/settings/page.tsx`, `app/[locale]/(app)/settings/actions.ts`, `app/[locale]/(marketing)/pricing/actions.ts`, `components/SettingsPlanCard.tsx`, `components/SettingsCreditsCard.tsx`, `components/ui/badge.tsx`, `.env.example`
**Pattern extraction date:** 2026-08-01
