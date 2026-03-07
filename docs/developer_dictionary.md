# Developer Dictionary

This file maps common developer words and spoken phrases to the concepts used in this repository.

## Core Project Terms

- `terminal`
  The `node-pty`-backed WSL terminal surface inside the Electron window.
- `voice layer`
  The microphone capture, transcription, and dictation pipeline in `renderer.js` plus related helpers under `lib/`.
- `response replay`
  The assistant speech readback system that extracts terminal replies and plays them through TTS.
- `speech relay`
  `lib/speech-relay.js`, which turns finalized assistant text into replayable speech events.
- `speech interceptor`
  `lib/codex-speech-interceptor.js`, which decides when terminal output is a completed assistant reply.
- `terminal speech extraction`
  `lib/terminal-speech.js`, which cleans PTY output and drops prompt/tool noise before TTS.
- `developer dictionary`
  `lib/dev-dictionary.js`, the spoken-programming correction layer applied after STT and before terminal injection.
- `runtime log`
  The JSONL session logs written into the sibling `wsl-voice-terminal-runtime` folder.
- `doctor`
  `npm run doctor`, the quick local environment and dependency diagnostic.

## UI Terms

- `reply bubble`
  The replayable assistant-response bubble shown in the UI.
- `status bubble`
  A transient message near the mic button used for mode changes, capture status, and hints.
- `vaporize`
  The shared transient-bubble disappearance effect implemented in `lib/ui-vaporize.js`.
- `R button`
  The reply-history toggle in the UI.

## Speech / Transcription Terms

- `PTT`
  Push-to-talk mode.
- `Click`
  Toggle-to-record mode that injects text without auto-sending until Enter.
- `Auto`
  Always-listening mode with speech/noise gating.
- `OpenAI`
  Cloud STT/TTS path used when the API key is valid.
- `local Whisper`
  The faster-whisper fallback runtime installed into `.local-whisper-venv`.
- `local TTS`
  Windows `System.Speech` fallback path.

## Tool / Agent Terms

- `Codex`
  OpenAI Codex running in the terminal.
- `Claude Code`
  Claude Code running in the terminal.
- `agent reply`
  Assistant text that should be spoken back to the user.
- `tool chatter`
  Non-conversational terminal output such as spinners, tool calls, diffs, or command traces that should not be spoken.

## Recommended Mental Model

If you are reading or modifying the repo, think in four layers:

1. Electron shell
2. PTY / WSL terminal session
3. Dictation and developer dictionary input path
4. Assistant response replay output path
