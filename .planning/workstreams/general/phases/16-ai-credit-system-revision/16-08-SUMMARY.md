---
phase: 16-ai-credit-system-revision
plan: 08
status: complete
requirements-completed: [CRED-05, CRED-06, CRED-07, CRED-08, CRED-09, CRED-10]
---

# Plan 16-08 Summary: Phase gate, Stripe/env setup, end-to-end verification

## Task 1 — Automated gate (complete)

- `pnpm test:unit` 709/709, root `tsc` clean, `pnpm lint` clean; scripts `tsc` clean with `--ignoreDeprecations 6.0` (pre-existing TS5107).
- Fixed cross-plan breakage: `convex/noRefundGuard.test.ts` regex now allows the `refundDraw` credit-bucket helper.
- `16-VALIDATION.md` signed off (`nyquist_compliant: true`).

## Task 2 — Stripe prices and env vars (complete)

- Test mode (local dev account): pack prices created, Premium prices reused; env set on dev Convex and `.env.local`; idempotent re-run reports "reused existing".
- Prod Stripe account (Vercel's key, test mode): created pack + Premium prices, registered platform and Connect webhook endpoints, stored signing secrets on Vercel production.
- Vercel `noetree` production + preview: STRIPE*PACK*_, STRIPE*PREMIUM*_, APP_URL (prod), INTERNAL_WEBHOOK_SECRET (prod new; dev/preview corrected from a truncated value), STRIPE_WEBHOOK_SECRET/STRIPE_CONNECT_WEBHOOK_SECRET (prod).
- Convex `wooden-puma-16` (prod) and `frugal-echidna-922` (preview): pack price IDs, STRIPE_TOPUP_PRICE_ID, INTERNAL_WEBHOOK_SECRET.

## Task 3 — Manual end-to-end verification (complete, dev + Stripe test mode)

- Free user: 30 monthly credits, Nov 1 UTC reset shown; toolbar menu shows 1/3/5 cost chips; spending 5 credits updates badge and toasts.
- Boost pack purchase credited +300 purchased (history row shown).
- Zero balance: items disabled, selecting opens exhausted dialog with three packs and upgrade button; EN and FR verified.

## Deviations / fixes found

- `Object.hasOwn` broke Convex typecheck (lib ES2021) — replaced with `Object.prototype.hasOwnProperty.call`.
- Dev Convex lacked `INTERNAL_WEBHOOK_SECRET` — set.
- Vercel `INTERNAL_WEBHOOK_SECRET` was truncated — corrected / replaced.

## Open (non-blocking)

- Premium test-user 500-credit check not run in browser.
- Production redeploy needed so `convex deploy` pushes Phase 16 code to `wooden-puma-16`; then run one prod test purchase.
- No general preview `APP_URL` / preview Stripe webhook endpoint (previews are SSO-protected).
