# WSL Voice Terminal

Just WSL with a mic... thats it. I was sick of typing in the terminal but i wanted the terminal simplicity with codex/claude code

An Electron wrapper around `wsl.exe` with a real terminal, local mic controls, and spoken responses.

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

Saved-script install is the default recommendation. It is more transparent and less likely to trip antivirus heuristics than piping a remote script directly into PowerShell.

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

## Project Layout

- `install.ps1`: bootstrapper and setup
- `scripts/doctor.js`: diagnostics (`npm run doctor`)
- `launch-wsl-voice-terminal.bat`: app launcher

## Speech

- If `OPENAI_API_KEY` is valid, transcription uses OpenAI and reply TTS prefers OpenAI.
- If `OPENAI_API_KEY` is missing, still set to `your_key_here`, or rejected by OpenAI, transcription falls back to local `faster-whisper`.
- The installer can set up the local `faster-whisper` venv; rerun `install.ps1` or `npm run install:local-whisper` if it goes missing.
- Reply TTS can also fall back to local Windows speech when `TTS_PROVIDER=auto` and OpenAI TTS is unavailable, or when `TTS_PROVIDER=local`.
- Local fallback defaults to `base.en` on `cpu` with `int8` compute for Windows reliability. You can override that in `.env`.
- Local Whisper installs into `.local-whisper-venv` and downloads model/cache files locally. Those files are ignored by git and are not shipped in the repo.
- Local TTS uses Windows PowerShell and `System.Speech`, so it is Windows-only.

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

### WSL is missing

- WSL Voice Terminal needs `wsl.exe`.
- In an elevated Windows PowerShell window, run:

```powershell
wsl --install
```

- Reboot if Windows asks you to, then rerun `install.ps1`.
