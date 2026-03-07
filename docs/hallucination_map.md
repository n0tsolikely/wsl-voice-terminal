# Hallucination Map

This file documents common wrong assumptions that AI tools or new contributors may make about this repository.

## Common Wrong Assumptions

- `This is a Linux desktop app.`
  False. It is Windows-first and launches `wsl.exe` from Windows through Electron.

- `This app runs directly inside WSL.`
  False. Git work may happen in WSL, but the actual app runtime is the Windows Electron app.

- `The runtime logs live inside the repo.`
  False. They are written to a sibling folder named `wsl-voice-terminal-runtime`.

- `Speech replay is just TTS of whatever appears in the terminal.`
  False. The app tries to isolate assistant replies and avoid tool chatter, shell prompts, and user echo.

- `node-pty` is optional.`
  False. It is a core native dependency for the real terminal experience.

- `Python powers the whole app.`
  False. The app is primarily Node/Electron. Python is mainly for local Whisper fallback.

- `OpenAI is required.`
  False. OpenAI improves STT/TTS, but local Whisper and local Windows TTS can be used as fallbacks.

- `The launch batch file might redirect to another hidden install by default.`
  False. `launch-wsl-voice-terminal.bat` launches the repo folder it lives in.

- `Reply bubbles are just decorative UI.`
  False. They are part of the response replay system and allow replaying spoken agent replies.

- `If the terminal prints it, it should be spoken.`
  False. A large part of the architecture exists specifically to prevent that.

## Common Tool-Specific Misreads

- `Claude Code spinner/output lines are assistant speech.`
  Usually false. Spinner lines, token meters, shortcuts chrome, and diff noise should be filtered.

- `Codex prompt hints or placeholder prompts are assistant replies.`
  False. Prompt hints are UI chrome and should not be spoken.

- `Injected user drafts are completed assistant replies.`
  False. The speech interceptor must reject unsent or echoed user input.

## Safe Interpretation Rules

- Prefer runtime receipts over assumptions.
- Prefer `latest.jsonl` over guessed behavior.
- Treat Windows runtime behavior as source of truth for user-facing issues.
- Treat the Linux repo as the source of truth for git history and code changes.
