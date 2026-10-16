# Milestones — Noetree

## v1.0 Monétisation & Paiements (Shipped: 2026-07-12)

**Phases completed:** 7 phases, 32 plans, 68 tasks

**Key accomplishments:**

- Four new Convex tables (subscriptions, aiCredits, creditTransactions, processedStripeEvents) plus typed-but-unimplemented stub functions establishing stable type contracts for the Stripe monetization work in Phases 2-5.
- Installed Stripe server + browser SDKs via pnpm and patched proxy.ts to exclude /api/webhooks/
- Committable .env.example documenting all 5 Stripe env vars, plus real Stripe test-mode Pro (9€/mo recurring) and Top-up (2€ one-time) products/prices with Price IDs captured in .env.local
- All 5 required Stripe env vars propagated across Vercel's three scopes with per-environment webhook signing secrets, closing the last unmet ROADMAP Phase 1 success criterion (SC-2).
- All 5 ROADMAP Phase 2 success criteria were exercised live against the real webhook route and Convex dispatcher via `stripe listen`/`stripe trigger` (plus two crafted event replays for scenarios the default CLI fixtures can't produce); two genuine bugs were found and fixed along the way (a tsconfig gap that silently blocked every Convex function push, and an uncaught 500 on non-subscription `invoice.payment_failed` events) — final phase completion is gated on the user typing "approved".
- Real Stripe test-mode payment and duplicate-customer-reuse sign-off — closed via Plan 03-07's re-verification rather than a separate repeat checkout.
- Real Stripe test-mode checkout confirmed end-to-end after fixing two additional root causes beyond the original webhook-forwarder hypothesis: an HTTP/HTTPS scheme mismatch in the `stripe listen` command, and a test-mode account with no Products/Prices at all.
- Free-tier 20-note cap enforced server-side in Convex `createNote` via `ConvexError("NOTE_LIMIT_REACHED")`, surfaced through a shared upgrade modal wired to both note-creation call sites.
- Security threat model and ROADMAP SC1-SC5 verified: IDOR-safe identity derivation confirmed by grep, TOCTOU/idempotency confirmed by the 79/79-passing suite, and human UAT confirmed the toolbar badge, zero-credit dialog branching, deduction, and end-to-end Stripe top-up all work as designed
- Full test suite (93/93) and identity-derivation security gates confirmed automatically, followed by human UAT approval of all five ROADMAP success criteria plus the cancel/resume round-trip against live Stripe test-mode webhooks.

---

## v0.x — Foundation (shipped before GSD tracking)

**Shipped:** Prior to 2026-07-07

**What shipped:**

- Authentification (Clerk)
- CRUD notes avec Convex backend
- Structure arborescente parent/enfant
- Drag & drop des nœuds
- Éditeur de texte riche + panneaux redimensionnables (Shadcn Resizable)
- Dark mode
- Dashboard avec arbre de notes
- CI/CD GitHub Actions + Vercel (staging/production depuis tags)

**Last phase:** N/A (pré-GSD)

---
