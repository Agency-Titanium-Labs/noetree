# Phase 21 verification (goal-backward)

Gates: vitest 1528/1528, tsc root+convex clean, eslint clean.

- AUTO-01 (ghost text, Tab accepts, Esc dismisses; D-01..D-03): PARTIAL. Code + tests cover debounce 1.2 s, no IME/selection/code/read-only, widget decoration, Tab priority 1000 over list keymap, Esc/any key dismiss (ghostText.ts, ghostText.test.ts), Premium toggle persisted server-side. HUMAN_NEEDED: real browser check of IME, Tab in lists/tables, visual contrast, screen-reader announcement; touch devices have no accept path (L3).
- AUTO-02 (free to show, 1 credit once on accept): VERIFIED. aiSuggestions.ts accept (idempotent, same-tx applyDeduction, insert only after ok in ghostText.accept); tests in aiSuggestions.test.ts. Caveat M1: displayed text can be consumed without accepting (honest-client model).
- AUTO-03 (rate limit, unresolved cap): VERIFIED. issue enforces 20/min own bucket + 5 unresolved server-side with silent paused; cron sweeps. Caveat: no daily ceiling (M1).
  i18n en/fr key parity for Autocomplete confirmed (12 keys each). A11y: aria-hidden ghost + polite live region, labelled switch, locked state button labelled.
