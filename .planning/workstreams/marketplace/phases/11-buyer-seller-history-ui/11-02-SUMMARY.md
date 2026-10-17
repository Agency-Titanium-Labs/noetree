---
phase: 11-buyer-seller-history-ui
plan: 02
subsystem: connect-actions
tags: [stripe, connect, server-action, express-dashboard]
requires: []
provides:
  - createConnectLoginLink server action (argument-free, redirects to Stripe Express login link)
affects: [11-06]
tech-stack:
  added: []
  patterns: [redirect outside try/catch, server-side account id lookup]
key-files:
  created: []
  modified:
    - app/[locale]/(app)/settings/connect-actions.ts
    - app/[locale]/(app)/settings/connect-actions.test.ts
key-decisions:
  - "Server re-checks chargesEnabled && payoutsEnabled and throws connectNotActive (T-11-10)"
requirements-completed: [HIST-02]
duration: 5min
completed: 2026-10-17
---

# Phase 11 Plan 02: Connect Login Link Action Summary

`createConnectLoginLink()` mints a fresh Stripe Express dashboard login link for the caller's own connected account (id read server-side via `getMyConnectStatus`) and redirects to it; all non-active callers get a static error key with no Stripe call.

## Tasks

1. createConnectLoginLink server action with tests - commit `1732fcb`

Tests: `connect-actions.test.ts` 20/20 passing (13 existing plus 7 new).

## Deviations from Plan

None in code. Tooling note: `rtk vitest` triggered a pnpm reinstall prompt in the worktree (no TTY), so tests were run via `node node_modules/vitest/vitest.mjs run` instead.

## Known Stubs

None.

## Self-Check: PASSED
