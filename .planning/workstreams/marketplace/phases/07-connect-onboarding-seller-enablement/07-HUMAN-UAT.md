---
status: partial
phase: 07-connect-onboarding-seller-enablement
source: [07-VERIFICATION.md]
started: 2026-10-16
updated: 2026-10-16
---

## Current Test

[awaiting human decision]

## Tests

### 1. SC3 scope acknowledgement

expected: Phase 7 delivers only the `isSellerActive` gate; Phases 8/9 must call `internal.connectAccounts.isSellerActive` and throw `CONNECT_ONBOARDING_REQUIRED`. Add this to Phase 8/9 criteria.
result: [pending]

### 2. Reactive Pending -> Active flip without reload

expected: With /settings open while a pending account finishes onboarding, the badge flips to Active with no reload (Active was only observed on fresh load).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
