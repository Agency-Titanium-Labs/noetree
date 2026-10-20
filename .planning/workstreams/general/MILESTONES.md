# Milestones

## v1.3 IA et TVA marketplace (Completed: 2026-10-20, go-live pending)

**Phases completed:** 7 phases (17-23), 34/34 requirements, 1576 tests

**Key accomplishments:**

- Metering foundation: reserve/settle/refund AI credits, single tier source, rate limits and kill switch (17)
- Budgeted, permission-aware, injection-safe context assembly, purchased marketplace notes excluded (18)
- Streaming AI chat in the editor, free tier (19)
- Premium AI context and tree agent: propose, preview, atomic apply, undo (20)
- Ghost-text autocomplete charged 1 credit on accept (21); semantic link suggestions the user accepts or ignores (22)
- Marketplace VAT split absorbed in the price, configurable rate, off by default (23)
- Dependencies upgraded (next 16.4.2, tiptap 3.32.0, convex 1.47.0), audit clean

Audit: tech_debt, no blockers (`milestones/v1.3-MILESTONE-AUDIT.md`). Known deferred items at close: 8 (see STATE.md Deferred Items). Production not pushed yet.

---

## v1.2 Pricing V2 & Fonctionnalités Sociales (Shipped: 2026-10-18)

**Phases completed:** 5 phases, 35 plans, 19 tasks

**Key accomplishments:**

- Notes are unlimited on every plan; "Pro" became **Premium** (6.99€/month or 59€/year) everywhere, with a scripted, idempotent migration of existing subscribers (live cutover deferred to go-live).
- Sharing: unique view/edit share links and fully public notes (with descendants), free and unlimited.
- Threaded note comments with an in-app notification bell for note owners.
- Automatic version history with preview and safe restore; Free keeps ~24h, Premium keeps full history.
- AI credits revised: action-keyed costs (1/3/5) shown before use, Free 30/month and Premium 500/month grants, and three one-time credit packs (100/300/700) resolved server-side from Stripe price IDs.

**Known deferred items at close:** 5 (phase 12 live Stripe cutover, phase 13 sign-in round trip, phase 15 history-list lag, phase 15/16 UAT leftovers) — see v1.2-MILESTONE-AUDIT.md.

---
