# WSL Voice Terminal

Just WSL with a mic... thats it. I was sick of typing in the terminal but i wanted the terminal simplicity with codex/claude code

An Electron wrapper around `wsl.exe` with a real terminal, local mic controls, and spoken responses.

Created by Peter J. Reynolds (`notsolikely` / GitHub: `n0tsolikely`), building under Synapse Guild.

## Modes

- `PTT`: press and hold the mic button to record
- `Click`: click once to start talking, then press `Enter` or click the mic again to stop; your text is injected but not sent until the next `Enter`
- `Auto`: leave the mic on and have text start appearing in the terminal as you talk

## Quick Install

Run this in Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/n0tsolikely/wsl-voice-terminal/main/install.ps1 | iex"
```

Safer two-step install:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/n0tsolikely/wsl-voice-terminal/main/install.ps1 -OutFile .\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

What the installer does:

- checks for `winget`
- installs `Git`, `Node.js LTS`, and `Python 3.11` if they are missing
- clones or updates the repo into `%USERPROFILE%\wsl-voice-terminal` when run outside the repo
- runs `npm install`
- tries `npm run rebuild:native` if native dependencies fail
- creates `.env` from `.env.example` if needed
- creates `.local-whisper-venv` and installs `requirements.local-whisper.txt` if present
- launches the app when setup finishes
- future launches can prompt inside the app when a newer GitHub version is available

## Speech

- If `OPENAI_API_KEY` is valid, transcription uses OpenAI and reply TTS prefers OpenAI.
- If `OPENAI_API_KEY` is missing, still set to `your_key_here`, or rejected by OpenAI, transcription falls back to local `faster-whisper` automatically.
- When OpenAI transcription is unavailable, the app shows one normal status message that it is running local-only for that session instead of spamming red auth errors.
- On startup, the app checks the local `faster-whisper` runtime and reinstalls `requirements.local-whisper.txt` when the venv is missing or the requirements changed.
- Reply TTS can also fall back to local Windows speech when `TTS_PROVIDER=auto` and OpenAI TTS is unavailable, or when `TTS_PROVIDER=local`.
- Local fallback defaults to `base.en` on `cpu` with `int8` compute for Windows reliability. You can override that in `.env`.
- Local Whisper installs into `.local-whisper-venv` and downloads model/cache files locally. Those files are ignored by git and are not shipped in the repo.
- Local TTS uses Windows PowerShell and `System.Speech`, so it is Windows-only.

## Manual Install

1. `npm install`
2. Copy `.env.example` to `.env` if you want to set an OpenAI key, choose a TTS provider, or tweak local whisper settings
3. Optional: `npm run install:local-whisper` if you want to prewarm local Whisper before the first launch
4. Double-click `launch-wsl-voice-terminal.bat`

## Updates

- Standard installs from `install.ps1` can check GitHub on startup and prompt in-app when a newer version is available.
- Choosing `Yes` runs the same installer/update path, then restarts the app.
- Manual or mirrored copies can still update, but the app may migrate them into `%USERPROFILE%\\wsl-voice-terminal` so future updates stay simple.

## Notes

- This app must run on Windows. It spawns `wsl.exe` directly.
- `.env` is ignored by git. Commit `.env.example`, not your real key.
- `node-pty` is native. If install fails on Windows, rerun `npm run rebuild:native` after installing the Visual Studio C++ build tools.
- Codex reply speech is heuristic-based and works best when Codex runs inline, for example `codex --no-alt-screen`.

## Troubleshooting

### `node-pty` or native rebuild failures

- Install the Visual Studio C++ build tools.
- Rerun `npm install`.
- If `npm install` still fails, run `npm run rebuild:native`.
- Run `npm run doctor` to recheck the local setup.

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
