# Project Overview

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## What WSL Voice Terminal Is

WSL Voice Terminal is a Windows-first Electron app that wraps `wsl.exe` and adds voice input/output without replacing real terminal behavior.

Core characteristics:

- Electron shell
- real WSL terminal via `node-pty`
- microphone capture and speech-to-text
- spoken assistant reply readback
- transient UI bubbles for status and replies
- runtime JSONL logging for live debugging

## Core User Experience

The intended experience is:

- launch one terminal window, not extra shell junk
- talk naturally to inject terminal input
- keep normal Codex / Claude Code workflow intact
- hear conversational assistant replies back
- never hear code, diffs, shell spam, or approval junk
- get clean transient UI feedback with a premium vaporize dismissal effect

## Main Runtime Pieces

- `main.js`
  Electron main process, IPC wiring, PTY setup, STT/TTS services, update checks, close-vaporize coordination.
- `preload.js`
  Safe renderer bridge.
- `renderer.js`
  Main browser-side controller for terminal UI, mic controls, reply playback UI, status bubbles, reply history, and runtime logging.
- `lib/terminal-session.js`
  PTY-backed `wsl.exe` session.
- `lib/speech-relay.js`
  Finalized assistant speech queue and TTS dispatch.
- `lib/codex-speech-interceptor.js`
  Assistant reply state machine and boundary detection.
- `lib/terminal-speech.js`
  Terminal text cleanup and conversational prose extraction.
- `lib/ui-vaporize.js`
  Shared particle breakup animation used by transient bubbles and window-close vaporize.
- `lib/reply-history-ui.js`
  Reply bubble render helpers and history view helpers.
- `lib/voice-controls-ui.js`
  Voice-control label and UI-render helpers.

## UI Features That Matter

- reply bubbles on the right side of the UI
- replay/speaker button per reply bubble
- `R` button to recall recent replies
- mic/status bubbles near the voice controls
- Telegram-style vaporize dismissal effect

## Launcher Behavior

There are two launch files:

- `launch-wsl-voice-terminal.bat`
- `launch-wsl-voice-terminal.vbs`

The batch file is the actual launcher and precheck script. The VBS wrapper exists only to relaunch the batch file hidden so the intermediate shell window does not sit open.

See: [LAUNCH_SYSTEM.md](LAUNCH_SYSTEM.md)

## Runtime Logging

Runtime logs are written into a sibling directory:

- `wsl-voice-terminal-runtime/latest.jsonl`

On Windows, those logs are the ground truth when behavior and assumptions disagree.

## UX Goals

- Windows-first
- minimal friction
- natural voice interaction
- deterministic behavior
- premium polish without bloat
- safe install and safe recovery when dependencies fail
