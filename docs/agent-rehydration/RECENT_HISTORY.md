# Recent History

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## 1. Speech Extraction Improvements

Problem:

- TTS could read the wrong chunk, read echoed user drafts, or miss assistant replies entirely.

What changed:

- `lib/codex-speech-interceptor.js` was hardened around draft-echo rejection, no-boundary fallback, and assistant-surface detection.

Why it mattered:

- reply readback is one of the core product promises.

## 2. Prose Before / After Code Handling

Problem:

- replies containing explanation before code and after code were often reduced to only the tail or had useful prose dropped.

What changed:

- `lib/terminal-speech.js` was updated to keep conversational prose around code while still dropping code blocks and code-like lines.

Why it mattered:

- users want the explanation, not the code dump.

## 3. Tool-Handoff Speech Boundary

Problem:

- long mixed work sessions swallowed conversational narration once tool chatter, approval UI, diffs, or redraw noise began.

What changed:

- tool / approval / output transitions were promoted to valid speech boundaries in `lib/codex-speech-interceptor.js`.
- later fixes in `lib/terminal-speech.js` kept mid-run narration alive through whitespace-only redraw separators.

Why it mattered:

- assistant narration during work is useful and should be spoken before tool noise takes over.

## 4. Hidden Launcher Shell Fix

Problem:

- launching the app left an extra shell window open first, which felt janky.

What changed:

- `launch-wsl-voice-terminal.vbs` was added as a hidden handoff wrapper around `launch-wsl-voice-terminal.bat`.

Why it mattered:

- startup now feels cleaner without losing visible precheck failures.

## 5. Full-Window Vaporize On Close

Problem:

- the UI had signature vaporize polish for bubbles, but window close still ended abruptly.

What changed:

- close interception was added in `main.js`
- renderer now performs a full-window vaporize using the same particle engine before final close

Why it mattered:

- consistent premium polish.

## 6. IPC Payload Hardening

Problem:

- main-process IPC handlers were too trusting of renderer payloads.

What changed:

- normalized and clamped IPC payload handling was added so malformed payloads do not leak into PTY/STT/TTS paths.

Why it mattered:

- safer runtime and easier debugging.

## 7. Renderer UI Modularization

Problem:

- `renderer.js` was too monolithic.

What changed:

- safe UI-only seams were extracted into:
  - `lib/reply-history-ui.js`
  - `lib/voice-controls-ui.js`

Why it mattered:

- lower regression risk without a risky rewrite.

## Practical Takeaway

The current codebase is better than it was, but the fragile zones are still:

- speech boundary heuristics
- renderer orchestration size
- timing-heavy transient UI behavior

Future fixes should stay incremental and receipt-driven.
