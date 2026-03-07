# WSL Voice Terminal

Windows-first Electron wrapper around `wsl.exe` with a real terminal, mic-driven dictation, and spoken assistant replies.

It keeps the normal terminal workflow for Codex or Claude Code, but adds:

- push-to-talk, click-to-record, and always-listening voice modes
- developer-aware dictation cleanup before terminal injection
- assistant response replay bubbles with TTS
- local Whisper and local Windows TTS fallbacks
- runtime JSONL logging for live debugging

Created by Peter J. Reynolds (`notsolikely` / GitHub: `n0tsolikely`), building under Synapse Guild.

## Requirements

- Windows 10/11 only. This app launches `wsl.exe` directly.
- WSL is required. If you do not have it, run `wsl --install` in an elevated PowerShell window and reboot if asked.
- This is an Electron/Node app. Node.js is required and installed by the installer.
- Python 3.11 is used only for local Whisper fallback (optional).
- Native Electron dependencies (like `node-pty`) may require Visual Studio Build Tools with the "Desktop development with C++" workload on some machines.

## Modes

- `PTT`: press and hold the mic button to record
- `Click`: click once to start talking, then press `Enter` or click the mic again to stop; your text is injected but not sent until the next `Enter`
- `Auto`: leave the mic on and have text start appearing in the terminal as you talk

## Install (Recommended)

Saved-script install is the default recommendation.  
It is more transparent and less likely to trip antivirus heuristics than piping a remote script directly into PowerShell.

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/n0tsolikely/wsl-voice-terminal/main/install.ps1 -OutFile .\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

## Quick Dev Install (Advanced)

This is convenient but can trigger antivirus heuristics because it pipes a remote script directly into PowerShell.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/n0tsolikely/wsl-voice-terminal/main/install.ps1 | iex"
```

## What the Installer Does

- checks for `winget`
- installs `Git`, `Node.js LTS`, and `Python 3.11` if they are missing
- clones or updates the repo into `%USERPROFILE%\wsl-voice-terminal` when run outside the repo
- runs `npm install`
- tries `npm run rebuild:native` if native dependencies fail
- creates `.env` from `.env.example` if needed
- creates `.local-whisper-venv` and installs `requirements.local-whisper.txt` if present
- launches the app when setup finishes

## Manual Install

1. `npm install`
2. Copy `.env.example` to `.env` if you want to set an OpenAI key, choose a TTS provider, or tweak local whisper settings
3. Optional: `npm run install:local-whisper` if you want to prewarm local Whisper before the first launch
4. Run `launch-wsl-voice-terminal.bat`

## Developer Commands

- `npm run doctor`
  environment and dependency diagnostics
- `npm test`
  full Node test suite
- `npm run test:unit`
  same test suite, explicit developer alias
- `npm run rebuild:native`
  rebuild `node-pty` against the installed Electron version
- `npm run install:local-whisper`
  install or refresh the optional local Whisper runtime

## Project Layout

- `install.ps1`: bootstrapper and setup
- `scripts/doctor.js`: diagnostics (`npm run doctor`)
- `launch-wsl-voice-terminal.bat`: app launcher

## Architecture At A Glance

- `main.js`
  Electron main process, PTY wiring, STT/TTS services, update checks, runtime logging
- `preload.js`
  safe IPC bridge for the renderer
- `renderer.js`
  terminal UI, mic controls, replay bubbles, and transient bubble behavior
- `lib/terminal-session.js`
  `node-pty` wrapper that launches `wsl.exe`
- `lib/speech-relay.js`
  assistant response replay queue
- `lib/codex-speech-interceptor.js`
  decides when terminal output is a completed assistant reply
- `lib/terminal-speech.js`
  strips prompt chrome, tool chatter, and shell noise before TTS

See also:

- [docs/architecture.md](docs/architecture.md)
- [docs/developer_dictionary.md](docs/developer_dictionary.md)
- [docs/hallucination_map.md](docs/hallucination_map.md)
- [docs/github_metadata.md](docs/github_metadata.md)

## Speech

- If `OPENAI_API_KEY` is valid, transcription uses OpenAI and reply TTS prefers OpenAI.
- If `OPENAI_API_KEY` is missing, still set to `your_key_here`, or rejected by OpenAI, transcription falls back to local `faster-whisper`.
- The installer can set up the local `faster-whisper` venv; rerun `install.ps1` or `npm run install:local-whisper` if it goes missing.
- Reply TTS can also fall back to local Windows speech when `TTS_PROVIDER=auto` and OpenAI TTS is unavailable, or when `TTS_PROVIDER=local`.
- Local fallback defaults to `base.en` on `cpu` with `int8` compute for Windows reliability. You can override that in `.env`.
- Local Whisper installs into `.local-whisper-venv` and downloads model/cache files locally. Those files are ignored by git and are not shipped in the repo.
- Local TTS uses Windows PowerShell and `System.Speech`, so it is Windows-only.

## Response Replay

Response replay is the path that reads assistant replies back to you.

- PTY output is inspected by `lib/codex-speech-interceptor.js`
- terminal text is cleaned by `lib/terminal-speech.js`
- finalized assistant text is queued by `lib/speech-relay.js`
- the renderer shows replayable reply bubbles and can play the speech automatically

The system is designed to speak the assistant reply, not shell prompts, tool output, diffs, or your unsent draft text.

## Runtime Logs

Live debugging uses JSONL runtime logs written to a sibling folder:

- `wsl-voice-terminal-runtime/latest.jsonl`

Useful commands:

- `npm run doctor`
- inspect `latest.jsonl`
- inspect the session-specific `YYYYMMDD-HHMMSS-PID.jsonl` file next to it

## Updates

There is no auto-updater yet. To update, rerun `install.ps1` or `git pull` your repo. The installer will `git pull` the stable repo at `%USERPROFILE%\wsl-voice-terminal` when it is clean.

## Distribution Note

Future distribution should prefer a signed installer or a signed PowerShell script published as a GitHub Release asset. Until then, the saved-script install path above is the safest public recommendation.

## Notes

- This app must run on Windows. It spawns `wsl.exe` directly.
- `.env` is ignored by git. Commit `.env.example`, not your real key.
- `node-pty` is native. If install fails on Windows, rerun `npm run rebuild:native` after installing the Visual Studio C++ build tools.
- Codex reply speech is heuristic-based and works best when Codex runs inline, for example `codex --no-alt-screen`.

## Troubleshooting

### `node-pty` or native rebuild failures

- Install Visual Studio Build Tools or Visual Studio and include the "Desktop development with C++" workload.
- The installer now detects missing build tools and offers to install them automatically.
- Installing base Build Tools alone may still miss the required VC++ toolset; confirm the Desktop development with C++ workload (or equivalent VC++ components) is actually installed.
- If automatic Build Tools installation fails, open Visual Studio Build Tools manually, install Desktop development with C++, then rerun `install.ps1`.
- Rerun `npm install`.
- If `npm install` still fails, run `npm run rebuild:native`.
- Run `npm run doctor` to recheck the local setup.

### Local Whisper issues

- Ensure Python 3.11 is installed.
- Run `npm run install:local-whisper` or rerun `install.ps1`.
- Check `requirements.local-whisper.txt` and `.local-whisper-venv`.

### OpenAI key is wrong or missing

- The app will switch speech-to-text to local Whisper automatically.
- If you want OpenAI again, fix `OPENAI_API_KEY` in `.env` and restart the app.
- Leaving `.env` at `OPENAI_API_KEY=your_key_here` counts as no key and will stay local-only.

### Runtime debugging

- Run `npm run doctor` first.
- Check `wsl-voice-terminal-runtime/latest.jsonl`.
- For speech issues, inspect:
  - `speech.finalized`
  - `speech.audio`
  - `speech.playback_started`
  - `speech.playback_finished`
  - `speech.analysis`
  - `speech.analysis_rejected`
  - `speech.analysis_finalized`
  - `ui.status`
  - `ui.vaporize`

### WSL is missing

- WSL Voice Terminal needs `wsl.exe`.
- In an elevated Windows PowerShell window, run:

```powershell
wsl --install
```

- Reboot if Windows asks you to, then rerun `install.ps1`.
