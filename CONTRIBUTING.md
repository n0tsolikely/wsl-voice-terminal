# Contributing

## Ground Rules

- Keep the app Windows-first.
- Do not break `launch-wsl-voice-terminal.bat`.
- Do not remove `node-pty`.
- Prefer small, testable changes over broad rewrites.
- Preserve the terminal-first workflow. This project is not trying to become a chat UI.

## Repository Workflow

- Treat the Linux repo as the git source of truth.
- Treat the Windows repo copy as the runtime-facing copy the app is launched from.
- When changing runtime behavior, verify against the Windows runtime logs, not assumptions.

## Important Files

- `main.js`
  Electron main process and IPC wiring.
- `preload.js`
  safe renderer bridge.
- `renderer.js`
  terminal UI, mic controls, replay UI, transient bubble logic.
- `lib/terminal-session.js`
  PTY-backed WSL session.
- `lib/speech-relay.js`
  reply replay queue.
- `lib/codex-speech-interceptor.js`
  speech finalization heuristics.
- `lib/terminal-speech.js`
  terminal output cleanup for TTS.

## Local Development

1. Install dependencies:
   - `npm install`
2. Optional local Whisper setup:
   - `npm run install:local-whisper`
3. Run diagnostics:
   - `npm run doctor`
4. Run tests:
   - `npm test`
5. Launch on Windows:
   - `launch-wsl-voice-terminal.bat`

## Debugging Workflow

Use the runtime logs:

- `wsl-voice-terminal-runtime/latest.jsonl`

Start with:

- `npm run doctor`

Then inspect events such as:

- `pty.*`
- `stt.*`
- `speech.*`
- `dictation.*`
- `ui.*`

For the full event map, see [docs/runtime-events.md](docs/runtime-events.md).

## Change Guidance

- If you touch speech replay, add or update tests under `tests/`.
- If you touch install flow, update `README.md` and keep `install.ps1` conservative.
- If you touch transient UI behavior, keep the app responsive and do not block terminal input.

## Good First Improvements

- parser hardening based on real runtime receipts
- README clarity
- doctor script improvements
- runtime log observability
- UI polish that does not change the terminal architecture
