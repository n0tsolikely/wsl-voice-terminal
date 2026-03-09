# UI System

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## Core UI Pieces

The renderer UI is terminal-first, with a compact voice layer around it.

Important transient UI elements:

- assistant reply bubbles
- mic/status/mode bubbles
- reply-history recall bubbles

## Reply Bubbles

Natural lifecycle:

1. assistant reply is finalized
2. renderer registers the reply
3. bubble appears on the right side
4. TTS plays the reply
5. when playback finishes, the live bubble vaporizes
6. reply remains stored in history

Each bubble has a replay button.

Replay behavior:

- clicking replay reuses stored audio when available
- if audio is missing, preview TTS is requested for that reply text
- replay keeps that specific bubble visible until playback finishes

## Reply History (`R` Button)

Reply history is intentionally limited and simple.

Current behavior:

- only the last 3 replies are kept in memory
- pressing `R` recalls those replies as bubbles
- recalled bubbles remain visible for 7 seconds
- then they vaporize automatically
- if one recalled reply is replaying, that bubble stays visible until playback ends
- the other recalled bubbles still use their own normal timers

Important rule:

New live replies should not make all old replies reappear. Only the newest live reply should appear naturally. Older replies reappear only through explicit `R` recall.

## Status / Mic Bubbles

These are the short-lived messages near the mic controls, for example:

- initializing microphone
- transcribing
- mode changes
- warnings and hints

Non-sticky status bubbles use timed dismissal and should vaporize on:

- replacement by another status
- timeout
- explicit clear

## Vaporize Effect

The vaporize / Thanos-snap effect is a signature feature of this app.

It must not be removed or replaced.

Implementation:

- shared helper lives in `lib/ui-vaporize.js`
- bubble dismissal uses `vaporizeElement(...)`
- window-close vaporize reuses the same particle engine via `vaporizeImageDataUrl(...)`

Important rule:

If you change transient bubble behavior, keep the existing vaporize path intact. Do not downgrade to fade, slide, or blur-only removal.

## Window Close Vaporize

The close button (`X`) does not immediately kill the window.

Current flow:

- main process intercepts close
- renderer receives `app:begin-close-vaporize`
- renderer vaporizes the captured content area
- renderer acknowledges completion
- main process closes normally

There is a timeout guard so the app still closes if the renderer does not answer.
