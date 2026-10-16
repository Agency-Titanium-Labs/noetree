---
phase: 7
slug: connect-onboarding-seller-enablement
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-01
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `07-RESEARCH.md` "## Validation Architecture" (Test Framework / Requirements → Test Map /
> Sampling Rate / Wave 0 Gaps), cross-checked line-by-line against the `<automated>` verify blocks
> actually written into `07-01-PLAN.md` … `07-06-PLAN.md`.

---

## Test Infrastructure

| Property               | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| **Framework**          | Vitest `^4.1.10` + `convex-test` `^0.0.54` + `@edge-runtime/vm` `^5.0.0`   |
| **Config file**        | `vitest.config.ts` (repo root) — already present, no Wave 0 install needed |
| **Quick run command**  | `npx vitest run convex/connectAccounts.test.ts`                            |
| **Full suite command** | `npm run test:unit` (= `vitest run`)                                       |
| **Estimated runtime**  | ~5 s quick / ~30 s full suite                                              |

Supporting checks used as `<automated>` verifies alongside Vitest:

| Check           | Command                                    | Used by            |
| --------------- | ------------------------------------------ | ------------------ |
| Convex types    | `npx tsc --noEmit -p convex/tsconfig.json` | plans 01, 02       |
| App types       | `npx tsc --noEmit`                         | plan 05            |
| Lint            | `npx eslint <path>`                        | plan 05            |
| i18n parity     | inline `node -e` key-parity script         | plan 05 Task 1     |
| Env/secret gate | inline `node -e` `.env.local` parser       | plan 06 Tasks 1, 2 |

---

## Sampling Rate

- **After every task commit:** `npx vitest run convex/connectAccounts.test.ts` (Convex-layer tasks) or
  the task's own narrower `<automated>` command for non-Convex tasks (route test, action test,
  tsc/eslint, i18n parity script).
- **After every plan wave:** `npm run test:unit`
- **Before `/gsd:verify-work`:** Full suite green **and** the plan-06 manual Stripe CLI
  live-verification performed with its `stripe listen` output confirmed. Unit tests alone do NOT
  satisfy the phase gate (explicit research flag inherited from `.planning/research/SUMMARY.md`).
- **Max feedback latency:** ~30 seconds (full suite). Quick per-task feedback ~5 seconds.
- **Sampling continuity:** every one of the 13 tasks below carries an `<automated>` command. There is
  no run of 3 (or even 1) consecutive tasks without automated feedback.

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                        | Threat Ref                | Secure Behavior                                                                                                                                                     | Test Type                               | Automated Command                                                                                                                  | File Exists        | Status     |
| -------- | ---- | ---- | ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- |
| 07-01-01 | 01   | 1    | CONNECT-02, CONNECT-03             | —                         | Schema-only; adds `by_clerkUserId` / `by_stripeAccountId` indexes the identity-scoped lookups need                                                                  | type-check                              | `npx tsc --noEmit -p convex/tsconfig.json`                                                                                         | ✅ (tsconfig)      | ⬜ pending |
| 07-01-02 | 01   | 1    | CONNECT-02, CONNECT-03             | T-07-01, T-07-02, T-07-03 | `getMyConnectStatus` identity-derived (no client arg); `isSellerActive` is `internalQuery` and reads raw capability flags, never `status`                           | unit                                    | `npx vitest run convex/connectAccounts.test.ts`                                                                                    | 🆕 in-task (TDD)   | ⬜ pending |
| 07-02-01 | 02   | 2    | CONNECT-02                         | T-07-04                   | `recordPendingAccount` never re-points an existing row and rejects an id linked to another user                                                                     | unit                                    | `npx vitest run convex/connectAccounts.test.ts -t "recordPendingAccount"`                                                          | ✅                 | ⬜ pending |
| 07-02-02 | 02   | 2    | CONNECT-03                         | T-07-05, T-07-06, T-07-07 | `upsertFromStripeAccount` is the only writer of capability flags; replay-safe; owner-mismatch returns an anomaly without writing                                    | unit                                    | `npx vitest run convex/connectAccounts.test.ts`                                                                                    | ✅                 | ⬜ pending |
| 07-03-01 | 03   | 3    | CONNECT-02                         | T-07-10, T-07-12          | `INTERNAL_WEBHOOK_SECRET` guard as first statement; anomalies return sentinels instead of throwing                                                                  | unit                                    | `npx vitest run convex/connectAccounts.test.ts`                                                                                    | ✅                 | ⬜ pending |
| 07-03-02 | 03   | 3    | CONNECT-02                         | T-07-08, T-07-09, T-07-11 | Signature verified against `STRIPE_CONNECT_WEBHOOK_SECRET` before parsing; zero Convex calls on bad signature; no `rawBody` in logs                                 | unit                                    | `npx vitest run app/api/webhooks/stripe-connect/route.test.ts`                                                                     | 🆕 in-task (TDD)   | ⬜ pending |
| 07-03-03 | 03   | 3    | CONNECT-02                         | T-07-09                   | Connect secret documented as a distinct variable, never a fallback of the platform secret                                                                           | config grep                             | `grep -v '^#' .env.example \| grep -c '^STRIPE_CONNECT_WEBHOOK_SECRET='`                                                           | ✅                 | ⬜ pending |
| 07-04-01 | 04   | 3    | CONNECT-01                         | T-07-13 … T-07-17         | `clerkUserId` metadata from `auth()` only; `locale` allow-listed before URL interpolation; no `searchParams` read; `accounts.create` skipped for a returning seller | unit (mocked Stripe + ConvexHttpClient) | `npx vitest run "app/[locale]/(app)/settings/connect-actions.test.ts"`                                                             | 🆕 in-task (TDD)   | ⬜ pending |
| 07-05-01 | 05   | 4    | CONNECT-01, CONNECT-02             | T-07-21                   | All 12 seller-card strings are static literals — no interpolation, no `dangerouslySetInnerHTML`                                                                     | i18n parity script                      | inline `node -e` en/fr parity + 12-key presence check (see `07-05-PLAN.md` Task 1)                                                 | ✅                 | ⬜ pending |
| 07-05-02 | 05   | 4    | CONNECT-01, CONNECT-02             | T-07-18, T-07-19, T-07-20 | Card branches only on the webhook-synced `status`; `"skip"` sentinel when signed out; no client capability inference                                                | type-check + lint                       | `npx tsc --noEmit && npx eslint components/SettingsSellerCard.tsx`                                                                 | ✅                 | ⬜ pending |
| 07-05-03 | 05   | 4    | CONNECT-01, CONNECT-02             | T-07-18                   | Mount point introduces no `useSearchParams` / return-url-driven state                                                                                               | type-check + lint                       | `npx tsc --noEmit && npx eslint "app/[locale]/(app)/settings/page.tsx"`                                                            | ✅                 | ⬜ pending |
| 07-06-01 | 06   | 5    | CONNECT-01, CONNECT-02, CONNECT-03 | T-07-22, T-07-25          | Platform and Connect signing secrets proven present, `whsec_`-prefixed, and byte-distinct                                                                           | suite + env gate                        | `npm run test:unit && node -e "<secret distinctness check>"` (see `07-06-PLAN.md` Task 1)                                          | ✅                 | ⬜ pending |
| 07-06-02 | 06   | 5    | CONNECT-01                         | T-07-22                   | Dashboard Connect activation + second endpoint registered under its own secret                                                                                      | human-action + env gate                 | `node -e "<secret distinctness re-check>"` (see `07-06-PLAN.md` Task 2)                                                            | ✅                 | ⬜ pending |
| 07-06-03 | 06   | 5    | CONNECT-01, CONNECT-02, CONNECT-03 | T-07-23, T-07-24, T-07-26 | Live proof that capability flips originate from the signature-verified webhook, not the `return_url` trip; no secret leaks into the artifact                        | human-verify + artifact grep            | `grep -c 'whsec_[A-Za-z0-9]' .planning/phases/07-connect-onboarding-seller-enablement/07-LIVE-VERIFICATION.md` (must report **0**) | 🆕 written by task | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

_File Exists legend: ✅ = target file already exists when the task starts · 🆕 in-task = the task's own
TDD RED step creates the test file before implementation, so no Wave 0 scaffold is required._

_Note on 07-06-03: `grep -c` returns `0` and exits non-zero on a clean file. This verify is a
**leak assertion** — a reported count of `0` is the pass condition; any non-zero count is a hard fail
(a signing secret was pasted into a planning artifact). Treat the exit code as inverted for this one
command only._

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No Wave 0 scaffold plan is needed. Each of the
four research-flagged gaps is closed inside the phase itself:

- [x] `convex/connectAccounts.test.ts` (CONNECT-02, CONNECT-03) — created by **07-01 Task 2**'s TDD RED
      step, mirroring `convex/subscriptions.test.ts` structure; extended by 07-02 and 07-03. No task
      references a `MISSING` test file.
- [x] **No existing convention for testing `"use server"` action files** — research flagged this for an
      explicit planner decision. **Decision: option (b)** — this phase introduces the repo's first
      action-level test, `app/[locale]/(app)/settings/connect-actions.test.ts` (**07-04 Task 1**), with
      `stripe` and `ConvexHttpClient` mocked. The precedent gap in `pricing/actions.ts` /
      `settings/actions.ts` is not retroactively closed here.
- [x] `STRIPE_CONNECT_WEBHOOK_SECRET` documented in `.env.example` — **07-03 Task 3**, with its own
      grep verify.
- [x] Manual live-verification checklist — **07-06** is that artifact (`07-LIVE-VERIFICATION.md`),
      gated by two blocking checkpoints.

Framework install: not required (`vitest`, `convex-test`, `@edge-runtime/vm` already in
`package.json`; `vitest.config.ts` already present). Zero new packages this phase.

---

## Manual-Only Verifications

| Behavior                                                                                                                                                     | Requirement                        | Why Manual                                                                                                                          | Test Instructions                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Stripe Dashboard one-time configuration (Connect enabled, Express available, second Connect-scoped endpoint registered under its own secret)                 | CONNECT-01                         | Requires the developer's own Stripe Dashboard login; no CLI/API path exists and it cannot be verified from a build environment      | `07-06-PLAN.md` Task 2 (`checkpoint:human-action`, blocking). Backed by an automated `.env.local` secret-distinctness re-check |
| A real connected-account `account.updated` reaches `/api/webhooks/stripe-connect` (never the platform route) and flips the badge Pending → Active reactively | CONNECT-01, CONNECT-02, CONNECT-03 | Needs a live Stripe test-mode account, a foreground `stripe listen` process, and a browser session against Stripe's hosted KYC form | `07-06-PLAN.md` Task 3 (`checkpoint:human-verify`, blocking), steps 1–10. Evidence recorded in `07-LIVE-VERIFICATION.md`       |
| Badge stays **Pending** after an interrupted onboarding return trip (D-08 / Pitfall 1 against the running system)                                            | CONNECT-03                         | Requires deliberately abandoning Stripe's hosted flow mid-way — not reproducible against a mock                                     | `07-06-PLAN.md` Task 3, step 5                                                                                                 |

Everything else in this phase has automated verification. If `stripe listen --forward-connect-to`
fails to deliver, apply `07-RESEARCH.md` **Open Question 3 (RESOLVED)**'s tunnel /
Dashboard-registered-endpoint fallback before declaring the phase blocked — do not skip live
verification silently.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 13/13 tasks carry an `<automated>` block
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (zero such tasks exist)
- [x] Wave 0 covers all MISSING references — no task emits a `MISSING` reference; TDD RED steps create every new test file in-task
- [x] No watch-mode flags — every Vitest invocation uses `vitest run`; no `--watch`, no `--ui`
- [x] No E2E framework dependency — the two live checks are explicit blocking human checkpoints, not automated E2E
- [x] Feedback latency < 30 s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-01
