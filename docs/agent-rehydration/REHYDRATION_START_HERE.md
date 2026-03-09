# Codex Rehydration Pack

This is the operator briefing for future Codex sessions working on WSL Voice Terminal.

Read this entire pack before changing code:

1. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
2. [SPEECH_SYSTEM.md](SPEECH_SYSTEM.md)
3. [UI_SYSTEM.md](UI_SYSTEM.md)
4. [LAUNCH_SYSTEM.md](LAUNCH_SYSTEM.md)
5. [DIRECTORY_SYNC_RULE.md](DIRECTORY_SYNC_RULE.md)
6. [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)
7. [RECENT_HISTORY.md](RECENT_HISTORY.md)

## What This Repo Is

WSL Voice Terminal is a Windows-first Electron wrapper around `wsl.exe` with:

- a real PTY-backed terminal
- microphone-driven dictation
- STT for terminal input
- TTS for assistant reply readback
- replayable reply bubbles
- a particle vaporize effect for transient UI dismissal

## Source Of Truth

This Linux repository is the canonical codebase:

- `/home/notsolikely/wsl-voice-terminal`

The Windows launch copy is a mirror used for real launches and runtime verification:

- `C:\Users\peter\wsl-voice-terminal`

Do not treat the Windows copy as the git source of truth. Changes should land in the Linux repo, be pushed to GitHub `main`, then be mirrored to Windows.

## Design Philosophy

- simple over clever
- small over sprawling
- deterministic over model-heavy
- polished over flashy
- surgical fixes over rewrites

This project is intentionally not trying to become a chat UI. It is a voice-enabled terminal wrapper around WSL with minimal complexity.

## Speech Philosophy

Do not add a second AI layer for reply extraction unless the deterministic parser is truly exhausted.

Preferred approach:

- deterministic parsing
- explicit state-machine boundaries
- runtime-log-guided fixes
- tests built from real failure receipts

The current system is built around that philosophy. Preserve it unless there is strong evidence it is no longer sufficient.
