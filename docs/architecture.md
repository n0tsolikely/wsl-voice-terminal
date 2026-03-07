# Architecture

## Purpose

WSL Voice Terminal is a Windows-first Electron wrapper around `wsl.exe` with:

- a real terminal surface
- microphone-driven dictation
- optional OpenAI transcription/TTS
- local Whisper and Windows TTS fallbacks
- spoken response replay for terminal-native coding agents like Codex and Claude Code

## Entry Points

- `main.js`
  Main Electron process. Starts the app, owns IPC, spawns the PTY backend, configures update checks, and wires STT/TTS services.
- `preload.js`
  Safe Electron bridge. Exposes the IPC surface to the renderer without enabling full Node integration.
- `renderer.js`
  Browser-side UI controller. Owns mic controls, transient bubble UI, response replay presentation, playback queueing, and runtime logging.
- `index.html`
  UI shell and static layout.

## Core Runtime Modules

- `lib/terminal-session.js`
  Owns the `node-pty` session that launches `wsl.exe`.
- `lib/speech-relay.js`
  Converts finalized assistant text into replayable speech events and TTS audio.
- `lib/codex-speech-interceptor.js`
  Watches PTY input/output and decides when assistant text is complete enough to speak.
- `lib/terminal-speech.js`
  Cleans terminal output and extracts conversational assistant text while dropping prompt chrome, tool chatter, and shell noise.
- `lib/openai-audio-client.js`
  OpenAI STT/TTS client.
- `lib/local-whisper-client.js`
  Local faster-whisper fallback runtime.
- `lib/local-tts-client.js`
  Windows local speech fallback.
- `lib/tts-service.js`
  Provider selection and fallback coordinator for speech synthesis.
- `lib/dev-dictionary.js`
  Post-transcription developer dictionary and coding phrase correction layer.
- `lib/runtime-logger.js`
  JSONL runtime logging used for live debugging and regression tracing.
- `lib/ui-vaporize.js`
  Shared transient-bubble vaporize animation helper.

## UI and Voice Flow

1. Renderer starts and requests PTY startup through `preload.js`.
2. `main.js` creates `TerminalSession`.
3. `TerminalSession` launches `wsl.exe` through `node-pty`.
4. Renderer mic controls capture audio and send STT requests through IPC.
5. STT result is normalized by the dictation buffer and developer dictionary before terminal injection.
6. PTY output is observed by `SpeechRelay` through `CodexSpeechInterceptor`.
7. Finalized assistant text is emitted as:
   - `speech:finalized`
   - `speech:audio`
8. Renderer shows the reply bubble and can replay the spoken response on demand.

## Response Replay Layer

The response replay system is the speech readback path for assistant replies.

Relevant files:

- `lib/speech-relay.js`
- `lib/codex-speech-interceptor.js`
- `lib/terminal-speech.js`
- `renderer.js`

What it does:

- watches PTY output
- extracts only the assistant reply, not shell noise
- queues TTS generation
- renders replayable reply bubbles in the UI
- allows replay while keeping speech optional

What it must avoid:

- echoing unsent user drafts
- speaking tool output, diff spam, or footer chrome
- truncating multi-line assistant replies

## Repository Layout

- `lib/`
  Core runtime modules and app logic.
- `scripts/`
  Diagnostics and helper tooling.
- `tests/`
  Node test runner coverage for parsing, TTS/STT helpers, updater logic, and UI-adjacent helpers.
- `docs/`
  Contributor-facing architecture and metadata documentation.

## Runtime Logging

Runtime logs are written next to the repo in a sibling folder named:

- `wsl-voice-terminal-runtime`

Important event families:

- `pty.*`
- `stt.*`
- `speech.*`
- `dictation.*`
- `ui.*`
- `app.update_*`

Use `npm run doctor` first, then inspect `latest.jsonl` when debugging live behavior.
