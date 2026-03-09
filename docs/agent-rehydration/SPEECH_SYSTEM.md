# Speech System

Back to: [REHYDRATION_START_HERE.md](REHYDRATION_START_HERE.md)

## High-Level Flow

Speech pipeline:

1. STT captures spoken user input
2. transcript is normalized and injected into the terminal
3. terminal output is observed
4. conversational assistant prose is extracted
5. finalized speech text is sent to TTS
6. renderer plays audio and shows replay bubbles

In code:

- STT request/response routes through `main.js`
- terminal reply interception lives in `lib/codex-speech-interceptor.js`
- prose extraction lives in `lib/terminal-speech.js`
- finalized TTS queue lives in `lib/speech-relay.js`
- renderer playback queue lives in `renderer.js`

## State Machine Events

These runtime events are the main speech receipts:

- `speech.analysis`
- `speech.analysis_rejected`
- `speech.analysis_finalized`
- `speech.finalized`
- `speech.audio`
- `speech.playback_started`
- `speech.playback_finished`

Meaning:

- `speech.analysis`
  candidate speech was extracted and boundary state was evaluated
- `speech.analysis_rejected`
  candidate speech was dropped, usually because it looked like draft echo or lacked a valid boundary
- `speech.analysis_finalized`
  candidate speech passed the boundary rules and was emitted
- `speech.finalized`
  relay accepted the finalized text and queued TTS
- `speech.audio`
  TTS audio was generated
- `speech.playback_started`
  renderer began playing it
- `speech.playback_finished`
  renderer finished playback

## `codex-speech-interceptor.js`

This file is the speech state machine.

Responsibilities:

- track active assistant surface (`codex` / `claude`)
- observe PTY input and output
- ignore echoed draft/submitted user input
- collect terminal output into `captureBuffer`
- decide when the buffered prose is complete enough to speak
- emit finalized prose exactly once

Important implementation details:

- keeps a bounded `captureBuffer`
- preserves both head and tail when trimming long captures
- detects prompt-return boundaries
- detects tool / approval / output transitions
- can finalize on a stable repeated no-boundary pass if the same prose repeats

## `terminal-speech.js`

This file decides what counts as conversational prose.

Responsibilities:

- normalize terminal text
- strip ANSI noise
- drop fenced code blocks
- drop code-like paragraphs and lines
- drop diff bodies
- drop shell output
- drop approval UI
- drop footer/prompt chrome
- keep prose before code and prose after code when they are real explanation

It intentionally prefers deterministic filtering rules over model classification.

## Recent Key Fix: Flush Conversational Speech On Tool And Approval Transitions

Why this exists:

Long work sessions used to fail because assistant narration would be buffered, then swallowed by:

- `Ran ...` tool chatter
- approval UI
- diff output
- command output
- footer redraw noise

The system would then reject the whole candidate as `no-boundary`.

The fix added a tool-handoff / approval-handoff speech boundary:

- if conversational prose is already buffered
- and the next chunk clearly begins tool/approval/output noise
- flush the prose immediately
- keep the assistant turn alive for later narration segments

That is the main reason long mixed work sessions now speak multiple conversational checkpoints instead of only short clean replies.

## Why Tool Transitions Must Flush Speech

The assistant often narrates work like:

- `I confirmed the workspace and I'm creating a temp file...`
- `File is created. I'm editing it now...`
- `Diff is ready and shown. Now I'm doing cleanup...`

Those lines are useful and should be spoken even if they are immediately followed by:

- tool execution
- approval prompts
- diff output
- shell output

If the parser waits for a later clean prompt boundary, that narration gets contaminated and lost.

So tool/approval/output transitions are now valid speech boundaries.

## Debugging Rule

If TTS seems broken, verify where the failure actually happened:

- no `speech.finalized` -> extraction/state-machine problem
- `speech.finalized` but no `speech.audio` -> TTS generation/provider problem
- `speech.audio` but no `speech.playback_started` -> renderer playback problem

Use the Windows runtime log first before changing parser rules.
