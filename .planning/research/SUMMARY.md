# Project Research Summary

**Project:** Noetree v1.2 — "Pricing V2 & Fonctionnalités Sociales"
**Domain:** Extending an existing Next.js 15 + Convex + Clerk + Stripe note-taking SaaS with sharing/public links, comments, in-app notifications, version history, a freemium plan restructure, and tiered AI-credit economics
**Researched:** 2026-08-25
**Confidence:** HIGH

## Executive Summary

This milestone is six tightly-coupled features layered onto a mature, already-shipping codebase — not a greenfield build. The most important finding across all four research files is that almost nothing new needs to be _installed_: Convex's existing reactive-query engine already gives comments, notifications, share-link lists, and credit balances push-based real-time UI for free (the same mechanism already powering the AI-credits badge and subscription status), and the existing `stripe@22.3.0` SDK already exposes every API needed for tiered pricing and price migration. The only new runtime dependency worth adding is `sonner` for toasts (this project has no toast primitive today). Just as importantly, sharing/permissions is not new — a working `shares` table, `getUserPermission`, and `ShareDialog.tsx` already exist and predate v1.0; v1.2 only adds unique bearer-token links and a public/unauthenticated read path on top of that foundation.

The recommended approach is: (1) do the "connective tissue" work first — remove the Free note cap, rename Pro to Premium with new pricing, and generalize `isProUser` into a tri-state `getUserTier` helper, because Version History's retention tiering and the AI credit quota system both key off this entitlement field; (2) build Sharing (links + public notes) next, since Comments' visibility logic must resolve against the final access model (owner + shares + shareLinks) or it will need to be re-touched; (3) build Comments and Notifications on top of that finished access-resolution layer; (4) Version History can run in parallel with Comments; (5) the AI Credit revision is the most self-contained and should absorb any schedule slippage, going last.

The key risks are concentrated in three places, each independently flagged as "critical" in PITFALLS.md: (a) Stripe Price objects are immutable — swapping an env var does not migrate existing paying subscribers, who will silently keep renewing at the old 9-euro price forever unless an explicit subscriptions.update/Subscription Schedule migration script runs; (b) the public-link/public-note feature is a genuinely new, unauthenticated Convex query surface — reusing the existing identity-based getUserPermission/getTreeById helpers (or reusing a note's \_id as the public token) risks IDOR-class data exposure of an entire private note subtree to the internet; (c) both the AI-credit differentiated costs and the new 3-tier credit packs must resolve their amounts server-side from an enum/allowlist — trusting any client-supplied cost or pack tier is a silent revenue-leak/fraud vector, and the current codebase's amount: 50 hardcoding in the webhook is the exact anti-pattern to fix, not extend.

## Key Findings

### Recommended Stack

The stack is overwhelmingly "reuse what's installed." Convex reactive queries (useQuery) and native crons.ts cover every real-time and scheduled-job need across all five feature areas with zero new dependency — this is explicitly called out as the trap to avoid ("don't add a second real-time engine" like Pusher/Ably/Socket.io). The one genuinely new package is sonner@2.0.8 (the current shadcn-recommended toast component, replacing the deprecated Radix-Toast pattern this project never adopted). nanoid is optional (only needed if shorter share-URLs than crypto.randomUUID() are a stated UX requirement — not a security upgrade). diff/jsdiff (for a future version-diff viewer), @convex-dev/resend (for future email digests), and @convex-dev/rate-limiter (for future anonymous-write throttling) are all explicitly deferred past v1.2 MVP, not installed now.

**Core technologies:**

- Convex reactive queries (useQuery) — real-time notification bell, live comment threads, live share-link list — already the app's proven pattern (credits badge, subscription status)
- Convex native crons.ts (new file, not new package) — monthly Free-tier AI credit reset (no Stripe lifecycle event exists to hook this off) and storage-hygiene pruning of old version rows
- stripe@22.3.0 (already installed, no bump required) — SubscriptionUpdateParams.items[].price + proration_behavior for the Premium price migration; pre-created one-time Price objects for the 3 credit-pack SKUs
- sonner@2.0.8 (new dependency) — the only new runtime package needed; toast feedback for comments/links/restores/purchases

### Expected Features

**Must have (table stakes) — all P1 for v1.2 launch:**

- Unique shareable link per note with view/edit permission choice, distinct "public" toggle vs unlisted link, revoke/regenerate
- Free plan: remove the 20-note cap entirely (unlimited notes on every plan)
- Premium rename + new pricing (6.99 euros/mo, 59 euros/yr) + migration of existing 9-euro subscribers to the new price
- Note-level threaded comments (not inline/anchored) with resolve/unresolve
- In-app notification bell (unread badge) for new comments — reuses the existing AI-credits toolbar-badge UI pattern
- Automatic version snapshotting + restore with preview-before-restore (full snapshot, not diff)
- Tiered retention: Free ~24h, Premium unlimited/full history
- Per-action differentiated AI credit costs (1 basic / 3-5 complex) with pre-action cost display
- New monthly quotas per plan (Free ~30, Premium ~500) and 3 one-time credit packs (2e/100cr, 5e/300cr, 10e/700cr)

**Should have (competitive/differentiator):**

- "Sharing is 100% free and unlimited on every plan" as an explicit marketing/trust positioning
- Showing an action's credit cost before the user triggers it (cheap to build, high trust payoff per credit-pricing research)

**Defer (v1.x/v2+):**

- Inline/anchored (text-selection) comments — both Notion and Google Docs still struggle with anchor-drift on edits; ship note-level comments first
- Link expiration date, password-protected share links
- Version diff viewer (visual highlight between two versions)
- Email digest notifications (no email infra exists in this codebase today)
- Real-time collaborative co-editing, live presence indicators, per-user granular ACL — all explicitly out of scope per PROJECT.md

### Architecture Approach

Extend the existing Convex backend with four new tables (shareLinks, comments, notifications, noteVersions), each in its own module file (convex/shareLinks.ts, convex/comments.ts, convex/notifications.ts, convex/noteVersions.ts) rather than growing the already-~1170-line notes.ts. The single most important architectural move is generalizing the existing boolean isProUser() into a tri-state getUserTier(ctx): Promise<"free"|"premium"> helper, since three different features (version retention, AI quota, plan display) all need to branch on tier and should share one resolution source of truth rather than three independently-reasoned boolean checks.

**Major components:**

1. shareLinks table + resolveLinkAccess(token) — bearer-token capability access, deliberately separate from the identity-bound shares table (conflating them forces nullable-everything and complicates the already-audited getUserPermission)
2. New public route group outside the Clerk-gated (app) layout (e.g. app/[locale]/(public)/share/[token]/page.tsx) + a dedicated unauthenticated Convex query (getPublicNoteByToken) that never calls getUser/ctx.auth-gated helpers — the first genuinely anonymous read path in this codebase
3. comments/notifications tables with fan-out inside the addComment mutation (same transaction, in-process insert per recipient) — comment/notification access must call the existing getUserPermission, never a parallel authorization check
4. noteVersions table, written in the same transaction as updateNoteContent's content patch (never split across ctx.runMutation calls — an established codebase discipline already documented on aiCredits.ts's applyDeduction); retention enforced by read-time index filtering, not delete-on-write
5. getUserTier helper (replaces isProUser) feeding version-retention gating, AI-quota/cost lookup, and plan display — the single source of truth for all tier-dependent branches

### Critical Pitfalls

1. **Believing an env-var Price swap migrates existing subscribers** — Stripe Price.unit_amount is immutable; existing active Subscription objects keep renewing at the old 9-euro price with zero error surfaced anywhere unless an explicit subscriptions.update/Subscription Schedule migration script runs per subscriber. This is the single highest business-risk item in the milestone (real customer billing) and should be sequenced early for maximum runway.
2. **Reusing a note's \_id (or the existing identity-based getUserPermission) as/for the public share path** — Convex IDs are not designed as unguessable secrets and already leak elsewhere; public access must be a dedicated CSPRNG token (shareLinks.token) resolved by a minimal, purpose-built unauthenticated query that returns only view-safe fields — never a null-tolerant variant of getTreeById/getUserPermission, which also return collaborator emails/internal metadata and inherit dangerous downward permission-propagation semantics.
3. **Comments/notifications re-implementing authorization instead of reusing getUserPermission, and unbounded notification fan-out** — a parallel "if (owner or isPublic)" check will drift from the audited permission helper; fan-out must be explicitly bounded to registered collaborators (never anonymous/public viewers, who have no user record to notify).
4. **Version snapshots on every autosave tick + restore with no undo-safety** — inserting a full-content row on every updateNoteContent call balloons storage; "restore" must snapshot the current state before overwriting (single atomic mutation) or a concurrent editor's work is silently and unrecoverably lost.
5. **Trusting a client-supplied credit cost or credit-pack tier** — both differentiated AI-action costs and the 3-SKU credit-pack amount must be resolved server-side from an enum/allowlist (mirroring the codebase's existing IDOR-conscious pattern of deriving clerkUserId only from authenticated identity); the current amount: 50 webhook hardcoding is the exact anti-pattern to fix when extending to 3 SKUs, not replicate.

## Implications for Roadmap

Based on combined research (FEATURES.md's dependency graph and ARCHITECTURE.md's suggested build order agree closely), suggested phase structure:

### Phase 1: Plan Restructure & Tier Foundation

**Rationale:** Version History's retention tiering and AI Credit quotas both key off the plan/entitlement field, so this must land first or the same field gets touched by three separate migrations. Also the lowest-risk, simplest change (removing a cap), best done before other phases might otherwise work around the old limit.
**Delivers:** Free note cap removed (and all associated dead UI/tests cleaned up, not just the server check); isProUser generalized to getUserTier(ctx): "free"|"premium"; Premium rename + new pricing (6.99 euros/mo, 59 euros/yr) on new Stripe Price objects; existing-subscriber migration script (subscriptions.update/Subscription Schedule, throttled)
**Addresses:** FEATURES.md Area 4 (Freemium Plan Restructure) in full
**Avoids:** PITFALLS Pitfall 1 (Price immutability / env-var-swap fallacy) and Pitfall 6 (dead gating logic / stale UI after cap removal)

### Phase 2: Sharing — Links & Public Notes

**Rationale:** Comments' visibility logic must resolve against the final access model (owner + shares + shareLinks); building comments first would mean revisiting every comment-visibility check once links/public notes ship. Sharing itself is additive on an already-working shares/getUserPermission foundation (lower implementation risk than its description suggests) and has zero dependency on Phase 1 (per PROJECT.md, sharing is free/unlimited on every plan by design).
**Delivers:** shareLinks table (separate from shares), crypto.randomUUID() token generation, revoke/regenerate, view/edit role selection in ShareDialog.tsx; a new public route group + dedicated unauthenticated getPublicNoteByToken query; explicit public-note toggle distinct from unlisted link sharing
**Uses:** crypto.randomUUID() (no new dependency); reuses radix-ui primitives already installed
**Implements:** shareLinks table + resolveLinkAccess(token), composed with (not merged into) getUserPermission
**Avoids:** PITFALLS Pitfall 2 (IDOR via \_id-as-token or reused authenticated helpers) — this phase should include an explicit security-review/IDOR-checklist step before merge, since it is the single highest-severity risk in the milestone (data exposure to the entire internet)

### Phase 3: Comments & Notifications

**Rationale:** Directly builds on Phase 2's finished access-resolution layer — a comment system only makes sense once there's a defined audience and permission level. Note-level (non-anchored) comments and in-app-only notifications are the correct MVP scope per FEATURES.md (inline/anchored comments deferred — anchor-drift is an unsolved problem even in mature products like Notion/Google Docs).
**Delivers:** comments table (note-level threading, resolve/unresolve), notifications table + reactive bell/badge (reusing the Phase 5 AI-credits badge UI pattern), in-mutation fan-out on addComment
**Addresses:** FEATURES.md Area 2 (Comments & Notifications) — note-level only, in-app-only
**Avoids:** PITFALLS Pitfall 3 (authorization drift from a parallel access check; unbounded fan-out to anonymous/public viewers)

### Phase 4: Version History & Restoration

**Rationale:** Depends only on Phase 1's getUserTier helper (already done); can run in parallel with Phase 3 if executor bandwidth allows, since it shares no other dependency with Comments.
**Delivers:** noteVersions table (same-transaction snapshot inside updateNoteContent), read-time tier-gated retention filtering (Free ~24h / Premium unlimited), snapshot-before-restore atomic mutation, preview-before-restore UI, storage-hygiene cron for cross-tier pruning
**Implements:** ARCHITECTURE.md Anti-Pattern 2 discipline (no split ctx.runMutation calls) and Anti-Pattern 3 avoidance (read-time filtering, never hard-delete-on-write for Free-tier enforcement)
**Avoids:** PITFALLS Pitfall 4 (storage explosion from per-keystroke snapshots; restore silently clobbering concurrent edits)

### Phase 5: AI Credit System Revision

**Rationale:** Most self-contained of the six features (touches aiCredits.ts/stripeWebhooks.ts almost exclusively, minimal UI surface), depends only on Phase 1's tier helper for quota lookup — safe to sequence last and absorb any schedule slippage from the architecturally riskier sharing/comments work.
**Delivers:** Server-side AI_ACTION_COSTS enum-driven deduction (1 basic / 3-5 complex) with pre-action cost display; tier-keyed monthly quotas (Free ~30, Premium ~500) including a new cron-based grant path for Free users (who have no Stripe lifecycle event to hook a reset off); 3-tier credit-pack Checkout flow with metadata-driven (never client-trusted) amount resolution in the webhook
**Addresses:** FEATURES.md Area 5 (Revised AI Credit Economics) in full
**Avoids:** PITFALLS Pitfall 5 (client-trusted cost/pack-tier — the exact amount: 50 hardcoding bug must be fixed, not extended to 3 SKUs)

### Phase Ordering Rationale

- **Dependency-driven:** Plan Restructure (Phase 1) is the connective tissue that Version History and AI Credits both key off — sequencing it first avoids two later migrations touching the same entitlement field. Sharing (Phase 2) has no dependency on Phase 1 by design (free/unlimited on every plan) but Comments (Phase 3) structurally requires Phase 2's finished access model.
- **Risk-driven:** The highest-external-risk item (live Stripe subscriber billing migration) is placed first for maximum runway before the milestone deadline; the highest-severity security risk (public/unauthenticated data exposure) gets its own phase with an explicit IDOR review gate rather than being folded into a larger phase.
- **Avoids re-work:** Building Comments before Sharing, or Version History's retention logic before getUserTier exists, would each require revisiting the same code twice — the suggested order eliminates both.
- **Cross-cutting note:** Phase 1's Stripe repricing and Phase 5's credit-pack Stripe config both touch live Price/Product objects and the same webhook file — consider treating them as one Stripe-config change session even though they're sequenced in different phases, to minimize how many times someone touches production Stripe configuration.

### Research Flags

Phases likely needing deeper research during planning (/gsd:plan-phase --research-phase N):

- **Phase 1 (Plan Restructure):** Stripe subscriber-migration mechanics (subscriptions.update vs Subscription Schedules, proration/timing choice, webhook-burst pacing) touch live billing for real paying customers — verify the exact migration approach and idempotency-key suffix pattern against the current Stripe API surface before executing.
- **Phase 2 (Sharing — Links & Public Notes):** First genuinely anonymous/unauthenticated Convex query path in this codebase, plus an IDOR-class security surface — worth a dedicated research/review pass on token design, propagation semantics (does public-on-parent cascade to children?), and revocation enforcement.

Phases with standard, well-documented patterns (skip research-phase):

- **Phase 3 (Comments & Notifications):** Convex reactive-query + in-mutation fan-out pattern is already proven in this codebase (AI-credits badge); mechanically extend, don't re-research.
- **Phase 4 (Version History):** Snapshot-in-same-transaction and read-time retention filtering both mirror established codebase discipline (applyDeduction's documented atomicity rule); standard pattern.
- **Phase 5 (AI Credit System Revision):** Direct, mechanical extension of the already-shipped single-SKU top-up flow and deduction system; the fix (server-side cost/tier resolution) is well-specified in PITFALLS.md.

## Confidence Assessment

| Area         | Confidence                                                                 | Notes                                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack        | HIGH                                                                       | Convex/Stripe API surfaces verified via Context7 against the actual installed major versions; npm versions verified live; shadcn Sonner migration corroborated across multiple independent sources                                                                                         |
| Features     | MEDIUM-HIGH                                                                | Cross-verified against Notion/Google Docs/Dropbox/Coda/OneDrive patterns and 2025-2026 AI-credit-pricing research; Noetree-specific numbers (24h retention, quota sizes, pack pricing) are pre-existing product decisions from PROJECT.md, not independently re-validated by this research |
| Architecture | HIGH                                                                       | Grounded in direct inspection of the live codebase (convex/schema.ts, notes.ts, subscriptions.ts, aiCredits.ts, stripeWebhooks.ts, helper.ts, ShareDialog.tsx), not training-data assumptions — includes the critical correction that sharing/permissions already exists pre-v1.0          |
| Pitfalls     | HIGH (codebase facts) / MEDIUM (Stripe migration mechanics, IDOR guidance) | Codebase-specific pitfalls grounded directly in inspected source; Stripe/OWASP guidance verified via WebSearch against official docs (Stripe and Convex are not in Context7's index for this research session)                                                                             |

**Overall confidence:** HIGH

### Gaps to Address

- **Free-tier AI credit grant mechanism today is unconfirmed.** It's unclear from the code whether Free users currently receive any aiCredits row at all (today's grant/reset paths are only triggered by Pro-subscription Stripe webhook events) — must be confirmed in REQUIREMENTS.md before Phase 5 can define the new Free-tier monthly quota/reset mechanism (likely a new cron-based path, since Free has no Stripe lifecycle event to hook into).
- **Anonymous editing via public/link-shared notes** — research recommends view-only for anonymous access (edit requires sign-in even via an "edit" role link), but this is a product decision, not a technical constraint; needs explicit confirmation in REQUIREMENTS.md.
- **Comment anchoring depth** — note-level (recommended for v1.2) vs text-selection-anchored comments is a major complexity fork (the latter requires a Tiptap comment-mark extension); needs an explicit REQUIREMENTS.md decision, though FEATURES.md and ARCHITECTURE.md both independently converge on "note-level only for MVP."
- **Public-note propagation semantics** — does making a note public cascade to descendant notes (matching the existing collaborator-share downward-propagation semantic) or is it strictly single-note? Must be decided explicitly and encoded in the new public query, not inherited accidentally from getUserPermission's tree-walk.
- **Notification delivery channels** — in-app-only is the consistent recommendation across STACK.md and ARCHITECTURE.md (no email infra exists today); confirm this isn't an implicit stakeholder expectation before REQUIREMENTS.md is finalized.
- **Comments-vs-restore interaction** — if a note is restored to a version predating a comment thread, should comments be deleted, archived, or left referencing stale content? FEATURES.md recommends "never delete on restore" as the safe default, but this needs an explicit product decision.

## Sources

### Primary (HIGH confidence)

- Context7 /stripe/stripe-node — SubscriptionScheduleUpdateParams, SubscriptionUpdateParams (proration_behavior, items[].price)
- Context7 /get-convex/convex-backend — cron job definition API (crons.interval/crons.cron/crons.monthly)
- Stripe: Change the price of existing subscriptions — https://docs.stripe.com/billing/subscriptions/change-price
- Stripe Prices API reference — https://docs.stripe.com/api/prices — Price immutability, Product/Price catalog pattern
- Manage products and prices — Stripe Docs — https://docs.stripe.com/products-prices/manage-prices
- Convex Best Practices — https://docs.convex.dev/understanding/best-practices/ — unguessable-ID access-control guidance
- Convex Authentication — https://docs.convex.dev/auth — ctx.auth.getUserIdentity() null behavior for unauthenticated callers
- Insecure Direct Object Reference Prevention — OWASP Cheat Sheet Series — https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
- Direct repo inspection: convex/schema.ts, convex/notes.ts, convex/subscriptions.ts, convex/aiCredits.ts, convex/stripeWebhooks.ts, convex/helpers/helper.ts, components/ShareDialog.tsx, package.json, git log (confirming shares predates v1.0 via commit d936066)
- .planning/PROJECT.md — milestone scope and constraints (project's own source of truth)
- npm view live registry queries for sonner, nanoid, diff, @convex-dev/rate-limiter, @convex-dev/resend, convex, stripe, radix-ui@1.5.0

### Secondary (MEDIUM confidence)

- WebSearch: shadcn Toast deprecation to Sonner replacement, corroborated across GitHub issue #7120 and shadcn/third-party docs
- WebSearch: Stripe subscriber price-migration operational best practices (batching/pacing), cross-referenced against Context7's stripe-node API surface for feasibility
- Competitor feature research (Notion, Google Docs/Workspace, Dropbox/Paper, Coda, OneDrive, Zoho WorkDrive) via cited articles in FEATURES.md — cross-verified across multiple independent products
- 2025-2026 AI-credit/hybrid-pricing SaaS research (HubSpot, Flexprice, Schematic, Metronome, Forbes, Softwarepricing.com)

### Tertiary (LOW confidence)

- None flagged — all findings in this synthesis trace to at least MEDIUM-confidence sources per the four research files.

---

_Research completed: 2026-08-25_
_Ready for roadmap: yes_
