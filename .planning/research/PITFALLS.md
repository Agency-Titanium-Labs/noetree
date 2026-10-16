# Pitfalls Research

**Domain:** Adding usage-limit removal, live-subscriber Stripe repricing, public sharing, comments/notifications, version history, and tiered AI credits to an existing Next.js 15 + Convex + Clerk + Stripe app with real paying subscribers (Noetree v1.2)
**Researched:** 2026-08-25
**Confidence:** HIGH (grounded directly in this repo's `convex/schema.ts`, `convex/notes.ts`, `convex/subscriptions.ts`, `convex/aiCredits.ts`, `convex/stripeWebhooks.ts`, `app/[locale]/(marketing)/pricing/actions.ts`) / MEDIUM on Stripe migration mechanics and IDOR guidance (verified against official Stripe docs and OWASP-aligned sources via WebSearch, not Context7 — Stripe/Convex are not in Context7's index for this session)

## Codebase facts that shape every pitfall below

- `isProUser()` (`convex/helpers/helper.ts`) resolves Pro **only** from `subscription?.status === "active"` — it never inspects a price or product ID. There is no `priceId`/`plan` field anywhere in `subscriptions` schema.
- `createCheckoutSession` (`app/[locale]/(marketing)/pricing/actions.ts`) hardcodes a single `line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID! }]` — there is no support today for choosing between two prices (e.g. monthly vs annual).
- `addCredits` (`convex/aiCredits.ts`, one-time payment path in `stripeWebhooks.ts`) hardcodes `amount: 50` — it never reads which Stripe Price/line item was actually purchased.
- `runAiAction` hardcodes a deduction of exactly `1` credit — there is no per-action cost concept yet, and `applyDeduction`'s `amount` parameter is currently only ever called with server-chosen constants (never client input) — that invariant is the thing to protect when this becomes configurable.
- Sharing already exists (`shares` table, `getUserPermission`, `requireEditAccess`, `inviteUser`) but is **100% identity-gated**: every read path starts with `getUser(ctx)` calling `ctx.auth.getUserIdentity()`, which returns `null`/throws for anonymous visitors. There is no unauthenticated query path, no share token, and no "public" flag anywhere in the schema today. "Unique shareable links" and "fully public notes" are net-new authorization surfaces, not an extension of an existing public path.
- Permission propagates **down** the tree: `getUserPermission`/`findSharePermission` walk from the requested note up to the nearest ancestor with a share record (or ownership). Sharing/making-public a parent note silently grants the same access to every descendant note. This existing semantic must be deliberately reused (or deliberately overridden) for the public/link feature — not reinvented.
- `notes.content` is a single `v.string()` field holding the full rich-text JSON blob (no chunking, no diffing). Any version-history design snapshots this whole string per version.
- Convex webhook idempotency is keyed by raw `stripeEventId` in `processedStripeEvents`, with one already-established workaround (`grantInitialCredits` suffixes its key with `:credits-grant` to avoid colliding with `upsertSubscription`'s row for the same event). Any new webhook-triggered write (credit packs, price-migration side effects) must follow this same distinct-suffix pattern or silently no-op.

---

## Critical Pitfalls

### Pitfall 1: Editing the Stripe Price instead of creating a new one, or believing the env var swap migrates existing subscribers

**What goes wrong:**
A Stripe `Price` object's `unit_amount` is immutable — there is no "edit the price" operation. Engineers who don't know this sometimes try to change the amount on the Stripe Dashboard (impossible) or, more commonly here, just swap `STRIPE_PRO_PRICE_ID` in `.env`/Vercel to a new price ID and consider the repricing "done." Because `createCheckoutSession` only reads `STRIPE_PRO_PRICE_ID` at the moment a **new** checkout session is created, this swap affects only brand-new subscribers. Every existing active Stripe `Subscription` object keeps referencing the **old** price/product and keeps renewing at 9€/month forever, silently — with no error, no webhook anomaly, nothing surfaced anywhere in this codebase to flag it.

**Why it happens:**
The team's mental model of "change the price" maps naturally to "edit a field," but Stripe's data model treats prices as immutable, append-only line items on a product. Nothing in this codebase currently tracks _which_ price a subscriber is on (`isProUser()` only checks `status`), so there is no in-app signal that migration didn't happen — the app will report these users as "Pro"/"Premium" correctly regardless, which masks the billing bug.

**How to avoid:**

1. Create a **new** Stripe Price object (or two: monthly 6.99€ + annual 59€) on the (renamed) Product — never attempt to edit the existing Price.
2. Explicitly migrate each existing active subscription's line item via `stripe.subscriptions.update(subId, { items: [{ id: existingItemId, price: newPriceId }], proration_behavior: "none" })`, or use a Subscription Schedule so the swap takes effect at each subscriber's own next renewal (no mid-cycle charge/credit surprise).
3. Archive (`active: false`) the old Price only after confirming zero subscriptions still reference it — archiving does not cancel or affect subscriptions already on it, it only blocks new checkouts, so it's safe to do early for the _checkout_ path but must not be treated as "subscribers are migrated."
4. Batch/throttle the migration script rather than firing all `subscriptions.update` calls simultaneously — each will emit a `customer.subscription.updated` webhook that Convex's `processWebhookEvent` action must process; a burst is fine at this app's current scale but should still be paced (e.g. one every few hundred ms) to avoid tripping Stripe API rate limits.

**Warning signs:**

- Stripe Dashboard "MRR" or a manual export still shows subscribers on the old Price ID weeks after the "repricing" shipped.
- No code path anywhere calls `stripe.subscriptions.update` with an `items`/`price` change — only `STRIPE_PRO_PRICE_ID` was touched.
- Support/finance asks "why is this customer still being charged 9€?" after the announced price-change date.

**Phase to address:**
Dedicated phase for "Stripe Premium rename & repricing," sequenced before or alongside the free-tier limit removal but _after_ it is decided whether Free also needs a schema change — this phase should include the subscriber-migration script as an explicit, tested deliverable, not an afterthought to the price-ID env var swap.

---

### Pitfall 2: Reusing `_id` (note ID or share ID) as the public share token, or reusing `getTreeById`/`getUserPermission` unauthenticated

**What goes wrong:**
The natural-seeming shortcut is: "the note already has an `_id`, just put that in the shareable URL and add a public-read branch to `getTreeById`." Two problems compound: (1) Convex document IDs are not designed as unguessable capability tokens — they already appear in plenty of client-visible places (child arrays, share records, browser history, referrer headers, error messages), so treating them as a secret is fragile; (2) `getTreeById`/`getUserPermission` are written assuming a resolvable `Doc<"users">` (`getUser(ctx)` throws `"User not found"` for anonymous callers) and, per the existing down-propagation semantic, a "public" flag placed on a parent note silently makes every descendant note public too — including descendants the owner never intended to expose (e.g., a private child note nested under a note they only meant to share the top level of).

**Why it happens:**
It is the path of least resistance: the sharing infrastructure (`shares` table, permission walk) already exists, so extending it to "add a role called `public`" looks like a two-line change. But that infrastructure was built entirely around authenticated Clerk identities (email/userId matching); anonymous access is a fundamentally different trust boundary that the existing helpers were never designed or reviewed for.

**How to avoid:**

- Mint a separate, cryptographically random `shareToken` (e.g. `crypto.randomBytes(24)` base62/base64url) stored in a new table (e.g. `publicLinks`: `noteId`, `token`, `role: "view"|"edit"`, `createdBy`, `revokedAt`) indexed `by_token`. Never expose `Id<"notes">` directly as the URL parameter.
- Write a dedicated, minimal **public** query (no `getUser(ctx)` call, no auth requirement) that takes only the token, looks up `publicLinks` by token, checks `revokedAt` is unset, and returns _only_ the fields a read-only anonymous viewer needs (title/content) — never route anonymous requests through `getTreeById`/`getNoteShares`, which also return collaborator emails and internal role/share metadata.
- Decide and implement propagation explicitly: does making a note public cascade to children (matching the existing collaborator-share semantic) or is public strictly single-note? Whichever is chosen, encode it as an explicit check in the new public query, not by accidentally inheriting `findSharePermission`'s bottom-up walk.
- Support **revocation**: deleting/flagging the `publicLinks` row (or rotating the token) must take effect on the very next query — Convex's reactivity means a subscribed client will re-run the query and see the revoked state live, but the _server_ check itself (not just client-side hiding) must gate on `revokedAt`.

**Warning signs:**

- Any new query/mutation for public access calls `getUser(ctx)`, `hasAccess`, or `getUserPermission` (all of these assume/require an authenticated `Doc<"users">`).
- The public URL contains something that looks like `j57...` (a raw Convex `Id<"notes">`) instead of a dedicated token.
- Sharing a single note publicly is later found to have exposed an entire private subtree.

**Phase to address:**
Sharing & public-links phase — this should be its own phase with an explicit security review step (IDOR checklist) before merging, since this is the single highest-severity risk in this milestone (data exposure of user content to the entire internet).

---

### Pitfall 3: Comments/notifications re-implementing authorization instead of reusing `getUserPermission`, and unbounded notification fan-out on public notes

**What goes wrong:**
Comments are naturally built as a new table + new mutations, and it's tempting to write a fresh, simpler access check ("if `note.owner === user._id` or `note.isPublic`, allow") rather than calling the existing `getUserPermission`. This creates two authorization implementations that will drift — a bug fixed in one (e.g. revoked shares, admin-vs-edit distinction) won't automatically apply to the other. Separately, notifications naively implemented as "notify everyone with access to this note" work fine for the current email/userId-based `shares` table (small, bounded list) but break once notes can be fully public: there is no bounded "everyone with access" list for a public note, and any implementation that queries `shares by_note` and also tries to notify anonymous public viewers has no user record to notify.

**Why it happens:**
Comments/notifications are typically built in a separate PR by someone focused on UX, not on rereading the sharing internals; and "notify everyone who can see this" is a plausible-sounding requirement that silently assumes a small, enumerable audience — which stops being true the moment "fully public" ships in the same milestone.

**How to avoid:**

- Comment write/read access must call the same `getUserPermission`/`hasAccess` helpers (or a thin wrapper around them) used by notes — never a parallel `if` chain.
- Explicitly scope notification fan-out to registered collaborators only (rows in `shares` with a resolvable `userId`, plus the owner) — public/anonymous viewers are never notification targets. Cap/paginate fan-out and do it in a mutation/action that won't time out if a note ever has an unusually large collaborator list.
- Notification payloads must not leak note content to a recipient whose access could have been revoked between the comment being posted and the notification being read (fetch current permission at render/click time, not just at send time).

**Warning signs:**

- Comment mutation file has its own `note.owner === user._id` check instead of importing/calling `getUserPermission`.
- Notification "fan out" logic queries `shares by_note` with `.collect()` and no bound, or attempts to look up a `users` row for every share regardless of whether `userId` is set (email-only shares have no user yet).

**Phase to address:**
Comments & notifications phase, scheduled **after** the sharing/public-links phase so the permission model it depends on is finalized first.

---

### Pitfall 4: Version-history snapshots on every autosave explode storage, and "restore" silently clobbers concurrent edits with no undo

**What goes wrong:**
Two related mistakes: (1) if a version row is inserted on every `updateNoteContent` call (which fires on debounced autosave, i.e. frequently), and each row stores the full `content` string (already an unbounded rich-text JSON blob per the schema), storage grows roughly linearly with keystrokes-worth-of-autosaves × note count — for active users this can produce thousands of near-duplicate rows per note per day. (2) "Restore to version X" implemented as a plain `ctx.db.patch(noteId, { content: oldVersion.content })` overwrites whatever the current content is with no snapshot of what was just overwritten — if another editor (this app already supports multi-editor sharing via `edit`/`admin` roles) saved a change moments before the restore, that change is gone with no way to recover it, and there's no optimistic-concurrency check (`updateNoteContent` today blind-patches with no version/timestamp comparison) to even detect the race.

**Why it happens:**
"Save a version on every content update" is the simplest possible design and matches how the existing `creditTransactions`-style append-only ledger pattern already used elsewhere in this codebase looks — but that pattern is fine for small, infrequent, bounded-size rows (credit deltas), not for large content blobs on every autosave tick. "Restore" is usually built as the mirror image of "save" (just patch content) without considering it needs its own undo-safety.

**How to avoid:**

- Snapshot on a coarser cadence: debounce version creation server-side (e.g. only create a new version row if the last one for this note is older than N minutes, or the diff exceeds a size/similarity threshold) rather than on every `updateNoteContent` call.
- Treat "restore" as: (a) snapshot the _current_ content as a new version first (so restoring is itself undoable), then (b) patch content to the target version's content — both inside a single mutation for atomicity, following the same "never split across `ctx.runMutation`" discipline already documented in `aiCredits.ts`'s `applyDeduction` comment.
- Add the retention split now, not later: a scheduled Convex cron job that deletes Free-tier version rows older than ~24h, scoped so it never touches Premium users' rows (this requires the version row to carry either a denormalized plan snapshot at write time, or a join to `isProUser` at cleanup time — the latter is safer since it reflects current plan, but means a user who downgrades gets their older-than-24h history pruned on the next cron run; decide and document whether that's immediate or grace-period, since silent immediate loss of history on downgrade will surprise users).
- Consider content-addressable or diff-based storage only if profiling shows the coarser-cadence full-snapshot approach is insufficient — don't build diffing speculatively; it adds real complexity (merge logic, corruption risk if a diff chain breaks) that this app's `notes.content` (opaque JSON blob, not a diff-friendly format) doesn't cleanly support anyway.

**Warning signs:**

- A version row is created inside `updateNoteContent` unconditionally.
- The restore mutation has no read-then-write-with-check step and no "snapshot current state first."
- The Convex dashboard shows the `noteVersions` (or similarly named) table growing faster than the `notes` table.

**Phase to address:**
Version history phase — snapshot cadence policy and the retention cron should be designed and reviewed before the restore UI is built, since retention policy affects what "restore" can even offer to Free users.

---

### Pitfall 5: Differentiated credit costs trusted from the client, and one-time credit packs identified by a hardcoded/guessed amount instead of the actual Stripe Price purchased

**What goes wrong:**
Today `runAiAction` deducts a hardcoded `1` and `addCredits` (webhook) credits a hardcoded `50` — neither ever trusts a client-supplied number. The natural way to add "3-5 credits for complex actions" is to add an `amount`/`cost` argument to a client-callable mutation; if that argument is accepted from the client instead of resolved server-side from an action-type enum, a user can call the mutation with `amount: 1` for an action that should cost 5, deducting less than intended (silent revenue leak, not a crash — so it's easy to ship undetected). Symmetrically, for the 3-tier credit packs, `checkout.session.completed` (payment mode) in `stripeWebhooks.ts` must determine _which_ pack tier was purchased to grant the right amount — Stripe Checkout Sessions don't include `line_items` in the webhook payload by default, so the natural-but-wrong shortcuts are: (a) keep the amount hardcoded and just change which Stripe Price ID triggers the webhook (breaks the moment there are 3 different prices hitting the same handler), or (b) trust a client-supplied `packSize` passed through session metadata that the _client_ chose rather than validating it against the actual Stripe Price ID that was paid for.

**How to avoid:**

- Define a server-side `ACTION_COSTS` map (action type → credit cost) inside `aiCredits.ts` (or a shared constants module) and have `runAiAction` accept an `actionType` enum argument, resolving cost from the map — never accept a numeric cost from the client. This mirrors the existing IDOR-conscious pattern already in this file ("clerkUserId is derived exclusively from the caller's authenticated identity... never a client-supplied argument") — apply the same discipline to cost.
- For credit packs: in the checkout-session-creation server action, set `metadata: { creditPackTier: "small" | "medium" | "large" }` on the Checkout Session (mirroring the existing `clerkUserId` metadata pattern already used for subscriptions) using a price ID chosen from a small server-side allowlist (`STRIPE_CREDIT_PACK_SMALL_PRICE_ID`, etc. — never accept an arbitrary price ID from the client). In the webhook, resolve the credited amount from that server-known tier→amount mapping (or from the actual Price ID on the session/line item, retrieved via `stripe.checkout.sessions.listLineItems`), never from client-supplied metadata alone without cross-checking it against what was actually paid.
- Keep the existing idempotency discipline: each new webhook-triggered credit mutation must key `processedStripeEvents` off the raw `stripeEventId` (single SKU today already does this correctly) — adding tiers doesn't change this, but a rewrite is a good moment to accidentally regress it, so add/keep a regression test per tier.

**Warning signs:**

- A client-callable mutation has a `v.number()` "amount"/"cost" argument that isn't purely for admin/internal use.
- The webhook handler infers credited amount from `event.type` or a single env var rather than from the specific Price ID / metadata tied to that Checkout Session.
- No test exercises "user attempts to call the AI action mutation with a spoofed low cost."

**Phase to address:**
AI credit system revision phase — this should include an explicit security-test pass (attempt to under-report cost from the client) before considering the phase done, since the existing codebase already treats this class of bug as a first-class concern (see `03-REVIEW.md CR-01` references throughout).

---

### Pitfall 6: Removing the Free-tier note cap leaves dead/inconsistent gating logic and silently changes the sole Free/Premium note-count differentiator without an intentional replacement

**What goes wrong:**
`createNote`'s `FREE_NOTE_LIMIT` check is small and self-contained, so "just delete the `if (!pro) {...}` block" looks safe — and functionally it is, for `createNote` itself. But: (1) the codebase has UI (upgrade modal / progress indicators, per `PROJECT.md`'s Phase 4 history) built specifically around "you're at 18/20 notes" — if that UI isn't also removed/repurposed, users will see a broken or nonsensical limit indicator; (2) the code comment trail (`ROADMAP SC1`, `D-01` references) and `notes.test.ts` assertions about the 20-note cap become stale documentation that misleads future readers into thinking a limit still exists; (3) removing the _only_ concrete, easily-understood Free-vs-Pro differentiator (unlimited notes) without the new differentiators (sharing being free/unlimited for everyone, per this milestone's scope) being clearly communicated in-product risks confusing existing Pro subscribers about what they're still paying for — this is a product-communication pitfall as much as a technical one, and directly touches subscriber retention right as the price is also changing.

**How to avoid:**

- Grep the whole codebase (not just `notes.ts`) for `FREE_NOTE_LIMIT`, `isProUser` call sites gating note-count UI, and any `NOTE_LIMIT_REACHED` `ConvexError` handling on the client, and remove/update all of them together in one PR — not just the server check.
- Update/delete the corresponding `notes.test.ts` cases so the test suite doesn't keep asserting behavior that no longer exists (a passing-but-meaningless test is worse than a deleted one here).
- Because this ships in the same milestone as the price change, sequence or bundle the in-app messaging so users see _why_ Premium is still worth 6.99€/month (unlimited AI-relevant features, full version history, priority support, etc.) at the same time they notice notes are now unlimited for Free — don't ship the cap removal silently ahead of the messaging.

**Warning signs:**

- `rg FREE_NOTE_LIMIT` or `rg NOTE_LIMIT_REACHED` still returns hits in client code after the "removal" PR.
- `notes.test.ts` still has a passing test titled something like "blocks note creation at 20 notes for free users."
- Support tickets after launch ask "what do I even get with Premium now?"

**Phase to address:**
Should be the first phase of the roadmap (simplest, lowest-risk, and removes a constraint other phases might otherwise need to work around), but its in-app messaging/UI cleanup should be explicitly called out as an in-scope task, not deferred.

---

## Technical Debt Patterns

| Shortcut                                                                                                 | Immediate Benefit                                                   | Long-term Cost                                                                                                                                  | When Acceptable                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swap `STRIPE_PRO_PRICE_ID` env var only, skip subscriber migration script                                | Ships "the price changed" fast for new signups                      | Existing subscribers pay old price indefinitely; revenue/reporting drift, support confusion                                                     | Never for this milestone — the requirement explicitly includes migrating existing subscribers                                                                   |
| Use note `_id` directly as the public share URL param                                                    | No new table/token generation needed                                | IDs already leak in other client-visible payloads; can't cheaply revoke without deleting the note; couples URL structure to internal Convex IDs | Never — token cost is trivial, risk is data exposure                                                                                                            |
| Snapshot full `content` string on every autosave for version history                                     | Simple, matches existing append-only ledger pattern in the codebase | Storage grows unbounded; Convex document count balloons; slows queries over time                                                                | Acceptable only as a very short-lived MVP behind a low, hardcoded snapshot-interval cap you already plan to replace before Premium's "full history" is marketed |
| Trust client-supplied credit "amount"/"packSize"                                                         | Fewer server-side enums/mappings to maintain                        | Silent under-charging of AI credits or credit-pack revenue leak                                                                                 | Never                                                                                                                                                           |
| Reuse `getTreeById`/`getUserPermission` for anonymous public viewers by making `getUser` tolerate `null` | Avoids writing a second query path                                  | Every authenticated-assuming helper downstream (comments, sharing UI, invite flow) must now also handle `null` user, multiplying audit surface  | Never — write a dedicated public read path instead                                                                                                              |

## Integration Gotchas

| Integration                                | Common Mistake                                                                                                                                                                                                                                 | Correct Approach                                                                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Price/Product                       | Editing price amount in Dashboard (impossible) or believing an env-var swap migrates live subscribers                                                                                                                                          | Create new Price, explicitly call `subscriptions.update` (or Subscription Schedule) per existing subscriber with `proration_behavior: "none"`                                                                       |
| Stripe Checkout (multi-price)              | Single hardcoded `line_items` price in `createCheckoutSession`; adding monthly/annual or credit-pack tiers without restructuring this function to accept a price/interval selector                                                             | Parameterize `createCheckoutSession`/the credit-pack action with a small server-side allowlist of valid price IDs per tier/interval; never accept an arbitrary price ID from the client                             |
| Stripe webhooks (`processWebhookEvent`)    | New credit-pack or migration-triggered `customer.subscription.updated` events processed without a distinct idempotency-key suffix, silently no-op'ing because they collide with an existing `processedStripeEvents` row for the same raw event | Follow the `grantInitialCredits` pattern: suffix the idempotency key per logical side-effect (e.g. `${eventId}:credits-grant`) whenever a single Stripe event should trigger more than one independent Convex write |
| Convex auth (`ctx.auth.getUserIdentity()`) | Building public/anonymous-accessible queries by making existing authenticated helpers (`getUser`, `hasAccess`) tolerate `null`                                                                                                                 | Write separate, explicitly-unauthenticated query functions for anonymous/public-link access, gated by a token argument instead of identity                                                                          |
| Convex schema validation                   | Adding a `versions`/`comments`/`publicLinks` table with a `content: v.any()` field that silently accepts shapes inconsistent with `notes.content: v.string()`                                                                                  | Keep the snapshot's content type identical to `notes.content`'s actual runtime shape (stringified JSON) and validate accordingly, or normalize both to the same validator during this milestone                     |

## Performance Traps

| Trap                                                                                                                  | Symptoms                                                                                         | Prevention                                                                                                                             | When It Breaks                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Version snapshot on every autosave tick                                                                               | `noteVersions` table row count grows far faster than `notes`/user count                          | Debounce snapshot creation server-side (time or diff-size threshold)                                                                   | Noticeable within days for even moderately active users given autosave frequency                           |
| Recursive `isOwnerOrAncestorOwner`/`findSharePermission` walks reused for public-link traffic                         | Public note view latency degrades on deep note trees; scales with anonymous traffic × tree depth | Give public-link access a flat token→noteId lookup, not the recursive ancestor walk designed for authenticated collaborators           | As soon as a public note is nested deep or gets meaningful anonymous traffic (e.g. shared on social media) |
| Unbounded notification fan-out query (`shares by_note` with no cap)                                                   | Slow/failing mutation on notes with many collaborators                                           | Bound/paginate fan-out; exclude anonymous/public viewers explicitly                                                                    | Once any note accumulates dozens of collaborators                                                          |
| `creditTransactions`/version rows queried with `.collect()` and no pagination (already the pattern in `listMyTopups`) | Settings/version-history UI slows for long-lived heavy users                                     | Add pagination before this table grows large, especially once version rows are added at much higher frequency than credit transactions | Once a user has months of frequent AI usage or version history                                             |

## Security Mistakes

| Mistake                                                                                                             | Risk                                                                                                 | Prevention                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Public/shareable-link query reuses an internal helper that also returns collaborator emails or full descendant tree | PII leak (collaborator emails) or unintended exposure of private nested notes to the public internet | Dedicated public query returning only the minimal fields needed for read-only anonymous rendering                      |
| Client-supplied credit "amount"/"cost"/"packSize" trusted without server-side resolution                            | Under-charged AI usage or fraudulent credit-pack crediting                                           | Resolve cost/amount exclusively from a server-side enum/allowlist, never from client input                             |
| Restoring a version without snapshotting current state first                                                        | Silent, unrecoverable loss of a concurrent editor's work                                             | Snapshot-then-restore as a single atomic mutation                                                                      |
| Public link token generated with a weak/predictable source (e.g. `Date.now()`-seeded or sequential)                 | Link enumeration/guessing exposes other users' notes                                                 | Use a CSPRNG (`crypto.randomBytes`) for tokens, sufficient length (≥16 bytes)                                          |
| No revocation check enforced server-side on every public query (only hidden client-side)                            | A "revoked" link still serves content if the client bypasses the UI                                  | Server-side check of `revokedAt`/token validity on every invocation of the public query, not just on initial page load |

## UX Pitfalls

| Pitfall                                                                                         | User Impact                                                                             | Better Approach                                                                                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Silently removing the note-limit UI without explaining what Premium now offers                  | Existing Pro subscribers feel they're paying for nothing, right when price also changes | Bundle limit-removal messaging with a clear "what Premium still gives you" callout in the same release |
| Restore-to-version with no confirmation/preview and no "undo the restore"                       | Users accidentally lose recent work with no recovery path                               | Snapshot-before-restore (see Pitfall 4) + confirmation dialog showing a diff/preview before committing |
| Revoked share link shows a generic error instead of "this link was revoked"                     | Confused viewers, support tickets                                                       | Distinct, clear state for expired/revoked vs never-existed vs no-permission                            |
| Free-tier ~24h version retention silently drops history with no warning as it approaches expiry | Users lose recovery ability without realizing the clock was running                     | Surface remaining retention time in the version-history UI for Free users                              |

## "Looks Done But Isn't" Checklist

- [ ] **Price/product rename:** Often missing the actual subscriber-migration script — verify by checking Stripe Dashboard that zero _active_ subscriptions still reference the old Price ID after rollout, not just that new checkouts use the new one.
- [ ] **Public/shareable links:** Often missing a genuinely separate unauthenticated query path — verify by testing access with no Clerk session at all (incognito, no cookies) and confirming private sibling/parent notes are not reachable.
- [ ] **Comments/notifications:** Often missing reuse of `getUserPermission` — verify by grepping the comments module for any independent access-check logic instead of calls into the existing permission helpers.
- [ ] **Version history:** Often missing the retention cron entirely (easy to ship "save version" and forget "delete old Free-tier versions") — verify a scheduled Convex function exists and has been exercised, not just designed.
- [ ] **AI credit costs/packs:** Often missing server-side cost resolution — verify by attempting to call the AI-action mutation (or credit-pack checkout creation) with a manipulated/unexpected argument and confirming the server ignores it and computes cost/amount independently.
- [ ] **Free-tier monthly AI quota:** Often missing entirely — today only Pro/Premium subscribers ever receive a credit grant (via Stripe webhooks); Free users need a wholly new, non-Stripe-triggered grant mechanism (cron or lazy-reset) — verify a brand-new Free-tier user actually receives their monthly quota with no purchase involved.

## Recovery Strategies

| Pitfall                                                                | Recovery Cost                                                                | Recovery Steps                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing subscribers left on old Stripe price after "repricing" ships  | LOW–MEDIUM                                                                   | Run the migration script retroactively (`subscriptions.update` per affected subscriber, `proration_behavior: none`); reconcile via a one-off report comparing `subscriptions` table against Stripe's price on each `stripeSubscriptionId` |
| Public link exposed more than intended (e.g. private descendant notes) | HIGH                                                                         | Immediately revoke/rotate the token, audit access logs if available, notify affected owner, then fix propagation logic before re-enabling public links                                                                                    |
| Credit cost/amount trusted from client and exploited                   | MEDIUM                                                                       | Patch the mutation to resolve cost server-side, then reconcile affected users' balances from the `creditTransactions` audit trail (already append-only, so reconstruction is possible)                                                    |
| Version-history storage grew unbounded before retention cron shipped   | LOW–MEDIUM                                                                   | Backfill-run the retention cron once against existing rows (with a dry-run mode first) rather than a one-off manual delete script                                                                                                         |
| Restore clobbered a concurrent edit                                    | LOW (if Pitfall 4's snapshot-before-restore was implemented) / HIGH (if not) | If snapshot-before-restore exists, the "restore of the restore" recovers the clobbered state; if not, the change is unrecoverable — this is the strongest argument for implementing Pitfall 4's mitigation from day one                   |

## Pitfall-to-Phase Mapping

| Pitfall                                                   | Prevention Phase                                      | Verification                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free-tier note cap removal leaves dead/stale gating logic | Phase: Remove note limit                              | `rg FREE_NOTE_LIMIT\|NOTE_LIMIT_REACHED` returns no hits outside git history; updated tests pass                                                                            |
| Stripe Price immutability / live-subscriber migration     | Phase: Premium rename & repricing                     | Stripe Dashboard shows 0 active subscriptions on the old Price ID post-migration; webhook idempotency tests pass for `customer.subscription.updated` fired by the migration |
| Public-link IDOR / propagation / token design             | Phase: Sharing & public links                         | Anonymous (no-cookie) access test suite confirms only intended notes/fields are reachable; token generation reviewed for CSPRNG use                                         |
| Comments/notifications authorization drift & fan-out      | Phase: Comments & notifications (after sharing phase) | Comment access enforced via shared `getUserPermission` (no duplicated check); notification fan-out excludes anonymous viewers and is bounded                                |
| Version-history storage growth & unsafe restore           | Phase: Version history & restore                      | Snapshot cadence policy documented and enforced; retention cron exists and has run; restore mutation snapshots current state before overwriting                             |
| Client-trusted credit cost / credit-pack tier             | Phase: AI credit system revision                      | Server ignores/overrides any client-supplied cost/amount in tests; webhook resolves pack tier from server-known Price ID mapping, not client metadata alone                 |

## Sources

- [Change the price of existing subscriptions — Stripe Docs](https://docs.stripe.com/billing/subscriptions/change-price) — HIGH confidence, official docs
- [Update a subscription — Stripe API Reference](https://docs.stripe.com/api/subscriptions/update) — HIGH confidence, official docs
- [Subscription schedules — Stripe Docs](https://docs.stripe.com/billing/subscriptions/subscription-schedules) — HIGH confidence, official docs
- [Manage products and prices — Stripe Docs](https://docs.stripe.com/products-prices/manage-prices) — HIGH confidence, official docs (Price immutability)
- [The Price object — Stripe API Reference](https://docs.stripe.com/api/prices/object) — HIGH confidence, official docs
- [Insecure Direct Object Reference Prevention — OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html) — HIGH confidence, authoritative security reference
- [Convex Best Practices — Convex Developer Hub](https://docs.convex.dev/understanding/best-practices/) — HIGH confidence, official docs (unguessable-ID access-control guidance)
- [Convex Authentication — Convex Developer Hub](https://docs.convex.dev/auth) — HIGH confidence, official docs (`ctx.auth.getUserIdentity()` null behavior for unauthenticated callers)
- This repository's own code and inline documentation: `convex/schema.ts`, `convex/notes.ts`, `convex/subscriptions.ts`, `convex/aiCredits.ts`, `convex/stripeWebhooks.ts`, `convex/helpers/helper.ts`, `app/[locale]/(marketing)/pricing/actions.ts` — HIGH confidence, primary source (direct code inspection), 2026-08-25

---

_Pitfalls research for: Noetree v1.2 "Pricing V2 & Fonctionnalités Sociales"_
_Researched: 2026-08-25_
