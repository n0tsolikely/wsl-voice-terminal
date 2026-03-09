# Launch System

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## Launch Chain

Launch path on Windows:

1. `launch-wsl-voice-terminal.bat`
2. `launch-wsl-voice-terminal.vbs`
3. hidden re-entry into `launch-wsl-voice-terminal.bat --run-hidden`
4. `npm start`
5. Electron app window

## Why There Are Two Launcher Files

`launch-wsl-voice-terminal.bat`

- real launcher
- performs prechecks
- validates `package.json`, `npm`, and `node_modules`
- prints visible failures if startup prerequisites are missing

`launch-wsl-voice-terminal.vbs`

- exists only to relaunch the batch file without leaving a visible shell window open
- keeps startup looking cleaner and more premium
- does not own app logic, STT, TTS, or WSL behavior

## Why The Hidden Launcher Was Added

Without the VBS handoff, launching the app left an extra command window visible before the Electron UI appeared. That felt janky.

The current design keeps:

- visible diagnostics when prechecks fail
- hidden shell handoff when launch succeeds

That preserves debuggability without leaving an extra console window on normal launches.

## Electron Startup

After `npm start`, Electron boots:

- `main.js`
- `preload.js`
- `renderer.js`

`main.js` then:

- configures permissions
- creates the window
- launches the PTY-backed WSL session
- wires STT/TTS and runtime logging

## Rule For Future Changes

Do not break double-click launching from the Windows copy.

If the launcher changes:

- keep visible precheck failures
- keep hidden success-path launch
- keep batch file compatibility
