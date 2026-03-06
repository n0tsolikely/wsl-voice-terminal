# WSL Voice Terminal

Just WSL with a mic.

An Electron wrapper around `wsl.exe` with a real terminal, local mic controls, and spoken responses.

## Modes

- `Hold`: press and hold the mic button to record
- `Click`: click once to start talking, then press `Enter` or click the mic again to stop; your text is injected but not sent until the next `Enter`
- `Auto`: leave the mic on and have text start appearing in the terminal as you talk

## Speech

- If `OPENAI_API_KEY` exists, transcription uses OpenAI and reply TTS is available.
- If `OPENAI_API_KEY` is empty, transcription falls back to local `faster-whisper` and installs itself on first use.
- Local fallback defaults to `base.en` on `cpu` with `int8` compute for Windows reliability. You can override that in `.env`.

## Run

1. `npm install`
2. Copy `.env.example` to `.env` if you want to set an OpenAI key or tweak local whisper settings
3. Double-click `launch-wsl-voice-terminal.bat`

## Notes

- This app must run on Windows. It spawns `wsl.exe` directly.
- `.env` is ignored by git. Commit `.env.example`, not your real key.
- `node-pty` is native. If install fails on Windows, rerun `npm run rebuild:native` after installing the Visual Studio C++ build tools.
- Codex reply speech is heuristic-based and works best when Codex runs inline, for example `codex --no-alt-screen`.
