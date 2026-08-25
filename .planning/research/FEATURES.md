# Feature Research

**Domain:** Hierarchical note-taking app — social features (sharing, comments, version history) + freemium/AI-credit monetization
**Researched:** 2026-08-25
**Confidence:** MEDIUM-HIGH (patterns cross-verified across Notion, Google Docs, Dropbox, Coda, OneDrive, and SaaS AI-credit pricing research; Noetree-specific numbers are already product decisions from PROJECT.md, not re-litigated here)

## Feature Landscape

This milestone bundles five distinct feature areas. Each is broken out below, then combined into one dependency graph and one MVP definition, because the roadmap needs to sequence all five together.

---

### Area 1 — Sharing & Access Rights

#### Table Stakes

| Feature                                                                        | Why Expected                                                                                                                                  | Complexity | Notes                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unique shareable link per note                                                 | Every note tool with sharing (Notion, Google Docs, Dropbox Paper, Craft) generates a link on demand                                           | LOW-MEDIUM | Must be a random, unguessable token (UUID/nanoid), never a sequential/incremental ID — sequential IDs allow enumeration attacks against other users' notes. [source: token security research] |
| Permission level on the link: view-only vs edit                                | Notion offers Full access / Can edit / Can comment / Can view; this is the baseline mental model users bring from other tools                 | LOW-MEDIUM | Store permission as an enum on the share record, not a boolean; leaves room to add "can comment" later without a schema rewrite                                                               |
| "Anyone with the link" access without requiring the visitor to have an account | Users expect to paste a link to a non-user (e.g. share via email/Slack) and have it just work                                                 | MEDIUM     | Requires a public/unauthenticated read path in Convex that still enforces the permission level server-side, not just client-side hiding                                                       |
| Revoke / regenerate link                                                       | Users expect an "undo" once a link has been shared too widely                                                                                 | LOW        | Simple: invalidate the token, issue a new one on demand                                                                                                                                       |
| Distinct "fully public" mode vs "unlisted, has-the-link" mode                  | Notion's "Publish to web" is a separate action from "Share via link" — public implies discoverable/indexable, unlisted implies obscurity-only | MEDIUM     | PROJECT.md explicitly calls out "fully public notes" as a distinct capability from link sharing — treat as two flags, not one                                                                 |

#### Differentiators

| Feature                                          | Value Proposition                                                                                                                                             | Complexity             | Notes                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sharing is 100% free and unlimited on every plan | Directly stated as a target in PROJECT.md; most competitors (Notion, Craft, Obsidian Publish) gate public sites, guest count, or link count behind paid tiers | LOW (policy, not code) | This is a trust/positioning differentiator — market it as "sharing is never a paywall" on the pricing page |
| Link expiration date                             | Notion added this for security-conscious sharing (e.g., time-boxed access to a doc)                                                                           | LOW                    | Nice v1.x add, not MVP-critical                                                                            |
| Password-protected link                          | Common ask for "public but not fully open" sharing                                                                                                            | MEDIUM                 | Defer — adds an auth-adjacent code path for a feature not in PROJECT.md scope                              |

#### Anti-Features

| Feature                                                                          | Why Requested                                                            | Why Problematic                                                                                                                                                                            | Alternative                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-user granular ACL (invite named people by email, each with individual roles) | Feels like "real" collaboration, matches Google Docs/Notion team sharing | Requires a full guest-identity + invite-acceptance system; Noetree is a personal-note tool, not a team workspace, and real-time collaboration is explicitly deferred to a future milestone | Link-based sharing with a permission level ("anyone with the link can view/edit") — same pattern most solo-user note tools (Craft, Obsidian Publish, Bear) ship with |
| Live "who's viewing this note" presence indicators                               | Seems like table stakes once sharing exists                              | Requires realtime presence infrastructure that overlaps with the explicitly out-of-scope co-editing feature                                                                                | None needed for v1.2 — defer to the real-time collaboration milestone                                                                                                |

---

### Area 2 — Comments & Notifications

#### Table Stakes

| Feature                                                    | Why Expected                                                                                                             | Complexity | Notes                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Comment on a note (thread, not just a single flat message) | Google Docs and Notion both use threaded comments (comment + replies); a flat unthreaded list feels broken by comparison | MEDIUM     | Simplify by anchoring comments to the whole note rather than to a text selection for v1 — see anti-feature below                               |
| Resolve / unresolve a thread                               | Google Docs and Notion both support this; resolved comments fade from view but remain in history                         | LOW-MEDIUM | Needs a `resolved` boolean + resolvedBy/resolvedAt, and an "show resolved" toggle in the UI                                                    |
| Notify the note owner when a comment is added              | Baseline expectation — a comment nobody sees is a dead feature                                                           | MEDIUM     | Convex's reactive queries make an in-app unread badge close to free; still need a persisted `notifications` table so the badge survives reload |
| In-app notification indicator (bell icon + unread count)   | In-app notification centers are the standard SaaS pattern and outperform email 3-10x on engagement                       | LOW-MEDIUM | Reuse the existing toolbar-badge pattern already built for AI credits (Phase 5) — same UI shape, different data source                         |

#### Differentiators

| Feature                                                                          | Value Proposition                                                                                   | Complexity | Notes                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous/guest commenting on a public or view-shared note (no account required) | Frictionless feedback loop — matches the "sharing should have zero barrier" positioning from Area 1 | MEDIUM     | Needs abuse mitigation even at MVP: rate-limit per IP/session, require a display name, consider a lightweight honeypot/rate-limit rather than full CAPTCHA                                                                                                                                                                                      |
| Inline/anchored comments (attached to a text selection, like Google Docs)        | Richer than note-level comments, lets discussion happen "where the disagreement is"                 | HIGH       | Anchor-drift problem: when the underlying text is edited or deleted, the anchor becomes stale/orphaned. Google Docs and Notion both still struggle with this ("resolved comments become invisible, the discussion disappears" — cited as a live complaint even in mature products). Recommend deferring to v1.x; ship note-level comments first |

#### Anti-Features

| Feature                                                       | Why Requested                          | Why Problematic                                                                        | Alternative                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Real-time typing/cursor presence inside comment threads       | Feels natural once comments exist      | Overlaps directly with the explicitly deferred real-time collaboration milestone       | Convex reactivity already gives near-real-time comment appearance on refresh/subscription without needing presence cursors  |
| Full chat/DM system attached to notes                         | Comments can feel like "just add chat" | Explicitly out of scope per PROJECT.md (deferred to a future milestone)                | Keep comments strictly note-scoped and threaded, not a general messaging surface                                            |
| @mention triggering notifications across a team/org hierarchy | Common in Notion/Coda team contexts    | Noetree has no team/workspace concept — this is solving a problem Noetree doesn't have | Simple pattern: comment → notify note owner (+ any prior participants in the thread). No org-wide mention resolution needed |

---

### Area 3 — Version History & Restoration

#### Table Stakes

| Feature                                                  | Why Expected                                                                                                             | Complexity | Notes                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic snapshotting (no manual "save version" action) | Google Docs, Notion, OneDrive, Dropbox all snapshot automatically on edit — manual save-points feel like a step backward | MEDIUM     | Snapshot on a debounce/interval (e.g., on blur or every N minutes of active editing), not on every keystroke — storage and write-volume concern |
| List of past versions with timestamps                    | Baseline discoverability — users need to see "what changed when" before restoring                                        | LOW        |                                                                                                                                                 |
| Restore to a previous version                            | The entire point of the feature                                                                                          | LOW-MEDIUM | Best practice: snapshot the _current_ state as a new version before overwriting with the restored one, so restore is never destructive/one-way  |
| Preview a version's content before committing to restore | Prevents accidental data loss; standard across all reviewed products                                                     | MEDIUM     | Full-content preview is enough for v1; do not build a diff viewer for MVP                                                                       |

#### Tiering Pattern (Free vs Premium)

Industry free-tier retention windows cluster much longer than Noetree's planned ~24h: OneDrive personal keeps the last 25 versions with no hard time cutoff, Dropbox free gives 30 days, and Microsoft's documented general pattern is "all versions for 30 days, then thinning out." Noetree's ~24h free retention is deliberately more aggressive than the norm — that is a stated product decision in PROJECT.md, not something this research is second-guessing, but it is worth flagging as a UX risk: users coming from Notion/Dropbox mental models will expect at least a few days of free history, so the UI must clearly communicate the shrinking retention window (e.g., "this version expires in 6h") to avoid a trust-breaking surprise the first time a user loses access to something they assumed was recoverable. Confidence: MEDIUM (based on cross-product retention norms, not a live user test).

Premium/unlimited history + restore-to-any-version matches the standard "paid tier removes the retention ceiling" pattern seen in Dropbox Business, Google Workspace, and Zoho WorkDrive.

#### Differentiators

| Feature                                                           | Value Proposition                                       | Complexity  | Notes                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Visual diff between two versions (highlighted additions/removals) | Meaningfully better than "here's the whole old version" | MEDIUM-HIGH | Good v1.x/v2 differentiator, not MVP — full-snapshot restore covers the actual job-to-be-done (undo a mistake / recover lost work) |

#### Anti-Features

| Feature                                         | Why Requested                      | Why Problematic                                                                                                             | Alternative                                                                                               |
| ----------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Manual named "save points" / Git-like branching | Power users sometimes ask for this | Massively over-engineered for a note app; introduces a mental model (branches, named commits) nobody expects in a note tool | Automatic, timestamped snapshots only — same as every competitor reviewed                                 |
| Snapshotting on every keystroke                 | Seems like "more history = better" | Storage/write-amplification blowup, and 99% of intermediate keystroke states are noise nobody will ever restore to          | Debounced/periodic snapshotting (interval or on-blur), which is what every reviewed product actually does |

---

### Area 4 — Freemium Plan Restructure

#### Table Stakes

| Feature                                                               | Why Expected                                                                                                 | Complexity                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the 20-note Free cap (unlimited notes on every plan)           | This is a direct reversal of an existing limit (PLAN-02/PLAN-04) — PROJECT.md already marks it invalidated   | LOW-MEDIUM (code)                | Mechanically simple (delete the enforcement check), but requires a migration pass: any Free users currently sitting at/over the old cap need the restriction actually lifted in Convex, and pricing-page copy needs to change everywhere the "20 notes" claim appears                                                                                                                                                                                                                           |
| Plan rename Pro → Premium, with new price points (6.99€/mo or 59€/yr) | Users need consistent naming across pricing page, Settings, Stripe Checkout, and webhook-derived plan labels | LOW-MEDIUM                       | Annual price (59€) vs 12× monthly (83.88€) is a ~30% discount — squarely inside the typical 20-33% annual-discount range used to incentivize annual commitment                                                                                                                                                                                                                                                                                                                                  |
| Migration of existing Pro subscribers to the new Premium price/name   | Existing subscribers are paying 9€/mo today; the new price (6.99€/mo) is a _decrease_                        | LOW (this is the easy direction) | Because this is a price decrease, standard SaaS grandfathering caution (6-month notice, phased rollout for increases) does not really apply — the harder question is purely mechanical: whether existing Stripe subscriptions move to the new Price object immediately or at next renewal. Existing infra (Stripe webhook → Convex `subscriptions`) already handles plan-status sync, so this is a Stripe Price/Product update + a proration or "apply at renewal" choice, not new architecture |

#### Differentiators

| Feature                                                  | Value Proposition                                                                                                                          | Complexity        | Notes                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Notes are always free and unlimited" as a stated policy | Directly contrasts with Notion (block-count limits pre-2021), Craft, and Obsidian Sync, all of which have historically gated storage/count | N/A (positioning) | Reinforces the sharing-is-free positioning from Area 1 — "the note-taking core is never the paywall, only AI usage is metered" is a coherent, marketable story |

#### Anti-Features

| Feature                                                      | Why Requested                                         | Why Problematic                                                                                                                                     | Alternative                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Multi-tier plan matrix (Free/Plus/Pro/Business)              | Feels like it captures more willingness-to-pay        | PROJECT.md explicitly keeps this to two tiers (Free/Premium) and rules out a Business/Teams plan for this milestone                                 | Keep the two-tier structure; resist adding a middle tier without validated demand |
| Re-introducing any note-count/storage limit later as a lever | Tempting once a product needs new monetization levers | Explicitly invalidated in PROJECT.md as a philosophy reversal — reintroducing it would break the newly-stated "notes are never the paywall" promise | AI usage (credits) is the only metered/monetized axis going forward               |

---

### Area 5 — Revised AI Credit Economics

#### Table Stakes

| Feature                                                                              | Why Expected                                                                                                                                                                                  | Complexity | Notes                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-action differentiated credit cost (1 credit basic, 3-5 credits complex/semantic) | Credit-based AI pricing grew 126% in 2025, and differentiated per-action costs (varying by task complexity) are described as the norm, not the exception, in current SaaS AI pricing research | MEDIUM     | The atomic, TOCTOU-safe deduction system already exists (Phase 5, CRED-04) — this is a parameterization change (cost registry keyed by action type) layered on existing infra, not a new deduction mechanism                                                           |
| New monthly quotas per plan (Free ~30, Premium ~500)                                 | Baseline "included allowance + pay for more" hybrid model — cited as ~65% of AI SaaS vendors' approach                                                                                        | LOW-MEDIUM | Reuses existing grant/reset-on-billing-cycle logic (Phase 2/06.1), just changes the numbers and adds a Free-tier monthly grant (today Free tier's credit quota behavior needs to be confirmed against Phase 5 delivery — flag as an open question for REQUIREMENTS.md) |
| 3 one-time purchase packs (2€=100cr, 5€=300cr, 10€=700cr) with volume discount       | Reuses the existing one-time Stripe Checkout top-up flow (PAY-05, Phase 5), extended from 1 SKU to 3                                                                                          | LOW        | Per-credit price improves with pack size (2€/100=0.020€/cr, 5€/300=0.0167€/cr, 10€/700=0.0143€/cr) — this is a standard volume-discount curve, consistent with typical credit-pack pricing ladders                                                                     |

#### Differentiators

| Feature                                                                                           | Value Proposition                                                                                                                               | Complexity | Notes                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Show the credit cost of an action _before_ the user triggers it (e.g., "this will use 3 credits") | Credit-based pricing research explicitly flags opaque/surprise costs as a top trust-eroding failure mode ("credit-based pricing's fatal flaws") | LOW        | Cheap to build (the cost registry already needs to exist for deduction), high trust payoff — should be treated as close to table-stakes given the research signal, not purely optional |

#### Anti-Features

| Feature                                            | Why Requested                    | Why Problematic                                                                                                                                                                                                                       | Alternative                                                                                                                                |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Unused monthly credits rolling over indefinitely   | Feels fairer to low-usage months | Complicates accounting, undermines quota predictability, and is not the pattern used by the reviewed hybrid-pricing SaaS products (monthly allocation resets are standard)                                                            | Explicit "credits reset monthly, do not roll over" — communicate clearly in the UI copy so it doesn't feel like a bait-and-switch          |
| Raw token/exact-usage metering exposed to the user | Feels "more accurate"            | Opaque to end users, breaks the simple mental model credits are meant to provide; described in research as part of why credit-based (not raw usage-based) pricing is preferred for consumer-facing products                           | Keep discrete, action-typed credit costs (1 / 3-5) — same pattern already shipped in Phase 5                                               |
| Silent overage auto-billing when quota is exceeded | Simpler than a hard block        | Billing a user without an explicit purchase action is a trust violation flagged in credit-pricing research; also conflicts with Noetree's already-shipped pattern (Phase 5 blocks at 0 credits with a plan-appropriate top-up prompt) | Keep the existing block-and-prompt pattern; extend it to per-action cost checks (block if balance < cost-of-action, not just balance == 0) |

---

## Feature Dependencies

```
Sharing & Access Rights (Area 1)
    ├──independent-of──> Plan Restructure (Area 4)      [free & unlimited on every plan by design]
    └──required-by────> Comments & Notifications (Area 2)
                             [permission level on a share defines who is allowed to comment;
                              anonymous/public commenting requires the public-link capability to exist first]

Comments & Notifications (Area 2)
    └──requires──> Notifications subsystem (new: notifications table + in-app bell/badge)
    └──impacted-by──> Version History & Restore (Area 3)
                             [restoring an old version can orphan comments anchored to text
                              that no longer exists post-restore — needs an explicit product decision:
                              keep comments regardless of restore, or archive them on restore]

Plan Restructure (Area 4)
    ├──gates──> AI Credit Economics (Area 5)     [quota numbers are defined per plan name/tier]
    └──gates──> Version History retention tier (Area 3)   [Free ~24h vs Premium unlimited reads the plan entitlement]

AI Credit Economics (Area 5)
    └──requires──> Plan Restructure (Area 4)     [Premium naming/entitlement must exist for quota logic to key off it]
    └──reuses──> existing atomic credit deduction system (Phase 5) — revision, not a new system

Version History & Restore (Area 3)
    └──requires──> Plan Restructure (Area 4)     [tiered retention reads the plan/entitlement field]
```

### Dependency Notes

- **Comments requires Sharing:** a comment system only makes sense once there is a defined audience (owner, link-viewer, link-editor, or public visitor) and a permission level that says whether that audience is even allowed to comment. Building Comments before Sharing would mean comments only work for the note owner talking to themselves.
- **Comments impacted-by Version History:** this is the one real cross-feature interaction in the whole milestone. If a user restores a note to a version from before a comment thread existed, the comment's anchor (if inline) or its relevance (if note-level) can become stale. Decide this explicitly in REQUIREMENTS.md — the safe default is "comments are never deleted by a restore, they just may reference content that's no longer current" — rather than attempting to silently reconcile anchors.
- **Version History requires Plan Restructure:** the Free (~24h) vs Premium (unlimited) retention split is a tier-gated feature, so the plan/entitlement field must already reflect "Premium" (not "Pro") before the retention logic can safely branch on it. Ship the plan rename first, or at minimum in the same phase, to avoid two migrations touching the same entitlement field.
- **AI Credit Economics requires Plan Restructure:** same reasoning — new monthly quotas differ by plan, so the quota-grant logic needs the renamed/repriced plan to exist first.
- **Sharing is independent of Plan Restructure:** explicitly and deliberately — PROJECT.md states sharing must be free and unlimited "regardless of plan," so this feature does not gate on or wait for the pricing work at all. It can be built in parallel with, or even before, Areas 3-5.

**Build-order implication for the roadmap:** Plan Restructure (Area 4) is the connective tissue — Version History tiering and AI Credit quotas both key off its entitlement field, so it should land early (first phase, or fully done before the phases that depend on it). Sharing (Area 1) has no dependency on anything and can run in parallel. Comments (Area 2) should follow Sharing. Version History (Area 3) can run in parallel with Sharing/Comments but its Premium-tier retention logic needs Plan Restructure done first; consider sequencing the comment/restore interaction decision explicitly if Comments and Version History land in the same phase.

## MVP Definition

### Launch With (v1.2 core)

- [ ] Unique share link per note with view/edit permission choice — core of the "sharing must be free & unlimited" promise
- [ ] Public-note toggle, distinct from unlisted link sharing
- [ ] Free plan: remove the 20-note cap entirely (unlimited notes for all)
- [ ] Premium rename + new pricing (6.99€/mo, 59€/yr) + existing-subscriber migration to the new price
- [ ] Note-level threaded comments (not inline/anchored) with resolve/unresolve
- [ ] In-app notification bell for "someone commented on your note" (reuse Phase 5 badge pattern)
- [ ] Automatic version snapshotting + restore, with preview before restore
- [ ] Free tier: ~24h version retention; Premium: full history, restore-to-any-version
- [ ] Per-action differentiated AI credit costs (1 basic / 3-5 complex) with pre-action cost display
- [ ] New monthly quotas (Free ~30, Premium ~500)
- [ ] 3 one-time credit packs (2€/100cr, 5€/300cr, 10€/700cr)

### Add After Validation (v1.x)

- [ ] Inline/anchored comments (attached to text selection, not just note-level)
- [ ] Link expiration date on shared links
- [ ] Password-protected share links
- [ ] Version diff viewer (visual highlight of changes between two versions)
- [ ] Email digest notifications alongside in-app bell

### Future Consideration (v2+)

- [ ] Real-time collaborative co-editing + chat (already explicitly deferred in PROJECT.md)
- [ ] Per-user granular ACL (invite specific people by email with individual roles, vs link-only sharing)
- [ ] Live presence indicators ("who's viewing this note right now")

## Feature Prioritization Matrix

| Feature                                              | User Value          | Implementation Cost    | Priority |
| ---------------------------------------------------- | ------------------- | ---------------------- | -------- |
| Unique share link (view/edit permission)             | HIGH                | MEDIUM                 | P1       |
| Public note toggle                                   | MEDIUM              | MEDIUM                 | P1       |
| Free plan unlimited notes                            | HIGH                | LOW                    | P1       |
| Premium rename + repricing + migration               | HIGH (business)     | LOW-MEDIUM             | P1       |
| Note-level comments + resolve                        | MEDIUM-HIGH         | MEDIUM                 | P1       |
| In-app comment notifications                         | MEDIUM              | LOW-MEDIUM             | P1       |
| Version snapshot + restore                           | HIGH                | MEDIUM                 | P1       |
| Free 24h / Premium unlimited retention tiering       | HIGH (monetization) | LOW (reads plan field) | P1       |
| Per-action AI credit costs + pre-action cost display | HIGH                | MEDIUM                 | P1       |
| New monthly quotas per plan                          | HIGH                | LOW-MEDIUM             | P1       |
| 3 credit purchase packs                              | MEDIUM              | LOW                    | P1       |
| Inline/anchored comments                             | MEDIUM              | HIGH                   | P2       |
| Link expiration / password protection                | LOW-MEDIUM          | LOW-MEDIUM             | P2       |
| Version diff viewer                                  | MEDIUM              | MEDIUM-HIGH            | P3       |
| Email digest notifications                           | LOW-MEDIUM          | MEDIUM                 | P3       |

**Priority key:**

- P1: Must have for v1.2 launch
- P2: Should have, add once P1 is stable
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature                      | Notion                                                                                            | Google Docs / Workspace                                            | Dropbox / Dropbox Paper                   | Noetree Approach                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share link permission levels | Full access / Can edit / Can comment / Can view                                                   | Viewer / Commenter / Editor                                        | Can edit / Can view                       | View / Edit (comment permission may fold into a future "can comment" level)                                                                                                                                                  |
| Public publishing            | Separate "Publish to web" action, distinct from link share                                        | Public web publishing available, separate from sharing             | Not a core feature (file-storage focused) | Explicit public-note toggle distinct from unlisted link, per PROJECT.md                                                                                                                                                      |
| Comments                     | Inline block comments, resolve/hide, sidebar (noted as "a sidebar no one checks" in some reviews) | Inline anchored comments, resolve/re-open threads, suggestion mode | Inline comments in Paper docs             | Note-level threaded comments at MVP; inline anchored comments deferred to v1.x to avoid the anchor-drift problem both Notion and Google Docs still struggle with                                                             |
| Version history (free tier)  | ~30 days (approximate, workspace-plan dependent)                                                  | Effectively generous on paid Workspace, more limited on free       | 30 days free                              | ~24h free — deliberately more aggressive than industry norm; needs clear UI expiry messaging to manage expectations                                                                                                          |
| Version history (paid tier)  | Extended/unlimited on paid plans                                                                  | Unlimited on paid Workspace tiers                                  | Extended (180 days+) on paid              | Unlimited/full history + restore-to-any-version on Premium                                                                                                                                                                   |
| AI credit/usage pricing      | N/A (not credit-metered for core doc features)                                                    | N/A                                                                | N/A                                       | Differentiated per-action credit cost (1 vs 3-5) + monthly quota + purchasable packs — matches the broader 2025-2026 hybrid AI-SaaS pricing trend (flat subscription + variable credits), not any single note-app competitor |

## Sources

- [Notion Sharing & Permissions: The Ultimate Guide — Thomas Frank](https://thomasjfrank.com/notion-sharing-permissions-the-ultimate-guide/)
- [Sharing & permissions settings in Notion — Notion Help Center](https://www.notion.com/help/sharing-and-permissions)
- [Comments in Notion — Thomas Frank](https://thomasjfrank.com/learn-notion/comments/)
- [How to Resolve Comments in Google Docs — GeeksforGeeks](https://www.geeksforgeeks.org/how-to-resolve-comments-in-google-docs/)
- [Why Google Docs Comments Get Lost (And How to Fix Collaboration) — Waymaker OS](https://www.waymakeros.com/learn/document-collaboration-comments-lost)
- [Google Docs Makes Commenting More Collaborative With Structured Discussions — TechCrunch](https://techcrunch.com/2011/03/16/google-docs-makes-comments-more-collaborative-with-structured-discussions/)
- [19 Best Free Document Version Control Software in 2026 — The Digital Project Manager](https://thedigitalprojectmanager.com/tools/best-free-document-version-control-software/)
- [File Retention Version History — Backblaze](https://www.backblaze.com/cloud-backup/features/extended-version-history)
- [File version settings — Zoho WorkDrive](https://help.zoho.com/portal/en/kb/workdrive/admin-console/settings/articles/file-version-settings)
- [The buyer's guide to credit-based AI pricing — HubSpot](https://blog.hubspot.com/website/ai-credits-buyers-guide)
- [Hybrid Pricing: The Complete Guide for SaaS and AI Companies — Flexprice](https://flexprice.io/blog/hybrid-pricing-guide)
- [AI Credits: How They Work, Pricing Models, and Implementation — Schematic](https://schematichq.com/blog/ai-credits)
- [The Rise of AI Credits: Why Cost-Plus Credit Models Work (Until They Don't) — Metronome](https://metronome.com/blog/the-rise-of-ai-credits-why-cost-plus-credit-models-work-until-they-dont)
- [Credit-Based Pricing for AI Software: The Six Fatal Flaws — Softwarepricing.com](https://softwarepricing.com/blog/credit-based-pricing-ai/)
- [Using Credit-Based Pricing In AI-Powered SaaS: What Works And What Doesn't — Forbes / Metronome](https://www.forbes.com/sites/metronome/2025/10/01/using-credit-based-pricing-in-ai-powered-saas-what-works-and-what-doesnt/)
- [SaaS Pricing Iteration: Managing Legacy Plans — Zuora](https://www.zuora.com/guides/saas-pricing-iteration-versioning/)
- [Grandfathering vs Forced Migration: The Strategic Approach to Price Changes — GetMonetizely](https://www.getmonetizely.com/articles/grandfathering-vs-forced-migration-the-strategic-approach-to-price-changes-for-existing-customers)
- [In-App Notification Center for SaaS: Design Patterns and Implementation Guide — SuprSend](https://www.suprsend.com/post/in-app-notification-center)
- [In-App vs Email Notifications for SaaS — Compared — Notilayer](https://www.notilayer.com/blog/in-app-notifications-vs-email-notifications-saas/)
- Project-internal: `.planning/PROJECT.md` (existing Phase 5/6 credit and Settings infra, current plan structure, explicit out-of-scope statements)

---

_Feature research for: Noetree v1.2 — Pricing V2 & Fonctionnalités Sociales_
_Researched: 2026-08-25_
