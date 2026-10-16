---
phase: 07-connect-onboarding-seller-enablement
plan: 06
status: complete
requirements-completed: [CONNECT-01, CONNECT-02, CONNECT-03]
key-files:
  created:
    - .planning/phases/07-connect-onboarding-seller-enablement/07-LIVE-VERIFICATION.md
---

# 07-06 Summary — Live Connect webhook verification

Pre-flight passed (144/144 unit tests). Live run with the Stripe CLI and a signed-in test user confirmed real
`account.updated` events reach `/api/webhooks/stripe-connect` (12/12 x 200, 0 to the platform route), the badge goes
Pending -> Active from the webhook, one `connectAccounts` row, no duplicate processed events. Details in
07-LIVE-VERIFICATION.md.

## Deviations / findings

- `stripe listen` uses ONE signing secret for both streams; "two distinct secrets" only applies to separate Dashboard
  endpoints (prod). Locally both env vars equal the CLI session secret.
- Dev server is HTTPS-only (`next dev --experimental-https`): forward targets must be `https://localhost:3000/...` with
  `--skip-verify`.
- Initial 500s were Convex dev not yet having the connectAccounts functions deployed; resolved by pushing.
- Reactive no-reload flip not watched live; Active confirmed on load.

## Self-Check: PASSED
