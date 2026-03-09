# Directory Sync Rule

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## Two Working Directories Exist

Linux canonical development repo:

- `/home/notsolikely/wsl-voice-terminal`

Windows runtime launch copy:

- `C:\Users\peter\wsl-voice-terminal`
- mounted in WSL as `/mnt/c/Users/peter/wsl-voice-terminal`

## Rule

The Linux repo is the canonical git workspace.

Whenever the Linux repository is updated:

1. commit in Linux
2. push to GitHub `main`
3. mirror Linux -> Windows

Future agents must maintain this sync.

## Why This Exists

- git operations are handled from Linux
- the app is usually launched and tested from the Windows copy
- runtime logs and real behavior receipts come from the Windows side

If the mirror is stale, debugging becomes fake because the tested build does not match GitHub.

## Mirror Method

Mirror with `rsync`.

Current workflow uses a full Linux -> Windows mirror with exclusions for local-only or heavyweight runtime state, such as:

- `.git`
- `node_modules`
- `.env`
- `.local-whisper-venv`

Practical rule:

- do not hand-wave sync status
- verify the Windows copy was updated after push
- if a user says another agent changed the Windows copy directly, inspect divergence immediately and fold the real change back into the Linux repo before the next push

## Push Rule

Push from the Linux repo to GitHub `main`, then mirror.

Do not treat the Windows copy as authoritative unless you are explicitly recovering a change that landed there outside git. If that happens, port it back into Linux, test, commit, push, and mirror again.
