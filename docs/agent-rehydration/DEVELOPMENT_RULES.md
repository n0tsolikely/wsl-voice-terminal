# Development Rules

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## Engineering Philosophy

- prefer deterministic parsing over AI classification
- avoid adding extra model layers unless deterministic parsing is clearly exhausted
- maintain simplicity
- keep modules small and focused
- prefer surgical fixes over big rewrites
- build from receipts, not guesses

## Hard Project Rules

- do not break the vaporize effect
- do not break the speech pipeline
- do not break WSL launch behavior
- do not break `node-pty`
- do not break the reply replay workflow
- do not change install flow casually

## Speech Rules

- conversational prose should be spoken
- code, diffs, shell output, approval UI, and redraw junk should stay silent
- use runtime logs to prove where the failure is:
  - extraction
  - TTS generation
  - playback

## UI Rules

- keep the Electron UI responsive
- keep transient bubble behavior lightweight
- preserve reply-history semantics
- preserve the signature vaporize dismissal path

## Architecture Rules

- `renderer.js` should remain orchestration, not absorb more unrelated complexity
- extract safe helper seams instead of rewriting the renderer wholesale
- keep `main.js` conservative because it owns PTY, IPC, STT/TTS, updates, and close behavior

## Testing Rules

- when touching speech parsing, add regression tests from real runtime receipts
- when touching transient UI helpers, keep behavior and timing stable
- when touching install flow, update docs conservatively

## Operational Rules

- trust the Windows runtime log over intuition
- trust the Linux repo as canonical source
- sync Linux -> Windows after pushes
