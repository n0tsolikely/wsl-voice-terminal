const SPEECH_SEGMENT_KINDS = Object.freeze({
  CHECKPOINT: 'checkpoint',
  FINAL: 'final',
  APPROVAL: 'approval',
  STATE_CUE: 'state_cue',
  SCREEN_ONLY: 'screen_only',
  USER_DRAFT: 'user_draft'
})

const SPEAKABLE_SEGMENT_KINDS = new Set([
  SPEECH_SEGMENT_KINDS.CHECKPOINT,
  SPEECH_SEGMENT_KINDS.FINAL,
  SPEECH_SEGMENT_KINDS.APPROVAL,
  SPEECH_SEGMENT_KINDS.STATE_CUE
])

function normalizeSegmentKind(kind) {
  const value = String(kind || '')
    .trim()
    .toLowerCase()

  if (Object.values(SPEECH_SEGMENT_KINDS).includes(value)) {
    return value
  }

  return SPEECH_SEGMENT_KINDS.FINAL
}

function isSpeakableSegmentKind(kind) {
  return SPEAKABLE_SEGMENT_KINDS.has(normalizeSegmentKind(kind))
}

function normalizeSegmentText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function createSegmentSignature({ kind, text }) {
  return `${normalizeSegmentKind(kind)}:${normalizeSegmentText(text)}`
}

module.exports = {
  SPEECH_SEGMENT_KINDS,
  createSegmentSignature,
  isSpeakableSegmentKind,
  normalizeSegmentKind,
  normalizeSegmentText
}
