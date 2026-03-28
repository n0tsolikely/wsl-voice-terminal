# Runtime Events

This project writes JSONL runtime logs into a sibling runtime directory:

- `wsl-voice-terminal-runtime/latest.jsonl`

Use this file to debug real behavior on Windows.

## Core Event Families

### PTY / Terminal

- `pty.start`
- `pty.input`
- `pty.output`
- `pty.resize`
- `pty.exit`
- `pty.dispose`

These events show the actual shell session and are the source of truth for what reached the terminal.

### Speech To Text

- `stt.request`
- `stt.success`
- `stt.error`
- `stt.fallback`
- `stt.status`

Use these to see whether transcription used OpenAI or local Whisper.

### Dictation / Mic

- `mic.intent`
- `mic.recording_started`
- `mic.recording_stopping`
- `mic.mode_changed`
- `mic.auto_enabled`
- `mic.auto_disabled`
- `dictation.live_started`
- `dictation.live_result`
- `dictation.live_error`
- `dictation.live_disabled`
- `dictation.live_ended`
- `dictation.auto_capture_rejected`
- `dictation.live_auto_rejected`
- `dictation.live_auto_injected`

Use these to debug push-to-talk, click mode, auto mode, and dictation noise rejection.

### Response Replay / TTS

- `speech.finalized`
- `speech.audio`
- `speech.audio_skipped`
- `speech.fallback`
- `speech.queue_deduped`
- `speech.queue_enqueued`
- `speech.queue_cleared`
- `speech.playback_started`
- `speech.playback_finished`
- `speech.playback_queue_drained`
- `speech.auto_reply_toggled`

These events describe what was chosen for spoken replay and whether it actually played.

Important payload fields on `speech.finalized` and `speech.audio`:

- `id`
  stable replay id for one emitted segment
- `kind`
  one of `checkpoint`, `final`, `approval`, or `state_cue`
- `turnId`
  the assistant turn the segment belongs to
- `sequence`
  emission order inside that turn

### Speech Analysis

- `speech.analysis`
- `speech.analysis_rejected`
- `speech.analysis_finalized`

These are the key debugging events for reply extraction:

- what candidate text was considered
- which boundary condition fired
- which internal segment kind was assigned
- whether a candidate was rejected as draft echo, screen-only chrome, or missing boundary

### UI

- `ui.status`
- `ui.vaporize`

These help debug transient bubble lifecycle and vaporize behavior.

### App / Updates / Permissions

- `app.ready`
- `app.status`
- `app.update_check`
- `app.update_prompt_shown`
- `app.update_prompt_dismissed`
- `app.update_apply_started`
- `app.update_apply_ready`
- `app.update_apply_failed`
- `permissions.check`
- `permissions.request`
- `permissions.device_request`

## Debugging Recipes

### Assistant reply was wrong or incomplete

Inspect:

- `pty.output`
- `speech.analysis`
- `speech.analysis_rejected`
- `speech.finalized`
- `speech.queue_deduped`

### User draft text was spoken back

Inspect:

- `pty.input`
- `speech.analysis_rejected`
- `speech.finalized`

### Bubble did not vaporize

Inspect:

- `ui.status`
- `ui.vaporize`

Check the `reason`, `durationMs`, `particleSize`, `travel`, and `gravity` fields.

### Local fallback confusion

Inspect:

- `stt.request`
- `stt.fallback`
- `speech.fallback`

### Audio was synthesized but never played

Inspect:

- `speech.audio`
- `speech.queue_enqueued`
- `speech.queue_cleared`
- `speech.playback_started`
- `speech.playback_finished`

## Practical Rule

When live behavior and code disagree, trust the Windows runtime log first.
