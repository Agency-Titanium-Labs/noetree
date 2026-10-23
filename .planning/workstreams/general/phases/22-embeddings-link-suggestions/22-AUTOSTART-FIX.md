# 22 - Related notes auto-start fix

## Bug

`NoteContent` passed `autoStart` unconditionally to `RelatedNotesPanel`. The
panel is keyed by note, so with the panel open, selecting another note remounted
it and it started a paid `linking` analysis (5 credits) with no click.

## Contract (22-CONTEXT D-08)

An analysis auto-starts only when the user opens the panel from the AI menu
entry "Generate note links", and only for the note open at that moment.

## Fix

- `NoteContent` holds a one-shot `linksRequest {noteId, seq}`, set only by the
  menu action (`onOpenLinks`). `autoStart` = `linksRequest.noteId === selected id`.
- The panel calls `onAutoStartConsumed` on first loaded result (whether or not
  it ran), which clears the request. The request is also cleared when another
  note is selected, when the panel closes, and when the chat is opened.
- Inside the panel the effect is the only paid call outside a click; it is
  guarded by a ref that resets only when `autoStart` goes false.
- Switching notes while open: the new note shows its stored results, or the idle
  state with the explicit "Find related notes (5 credits)" button.

## Other effects reviewed

- `AiChatPanel`: effects only call read-only queries (`previewContext`,
  `getMyCredits`) and local state; `sendMessage` runs only from `send`/`retry`
  (user actions). No paid effect.
- `AiTreeBatches`: read-only listing effect. No paid effect.

## Tests

- `RelatedNotesPanel.test.tsx`: consumed once; note change without autoStart
  starts nothing; fresh request on another note starts once.
- `NoteContent.dock.test.tsx`: menu opens and starts once; changing selection
  starts nothing; menu on another note starts once for that note.
