const DEFAULT_PTY_COLS = 80
const DEFAULT_PTY_ROWS = 24
const MIN_PTY_COLS = 20
const MAX_PTY_COLS = 400
const MIN_PTY_ROWS = 8
const MAX_PTY_ROWS = 120
const DEFAULT_TRANSCRIBE_MIME_TYPE = 'audio/webm'
const MAX_TRANSCRIBE_BYTES = 30 * 1024 * 1024
const MAX_RUNTIME_TYPE_LENGTH = 120

function normalizePtyDimensions(value) {
  const input = isObject(value) ? value : {}

  return {
    cols: clampInteger(input.cols, DEFAULT_PTY_COLS, MIN_PTY_COLS, MAX_PTY_COLS),
    rows: clampInteger(input.rows, DEFAULT_PTY_ROWS, MIN_PTY_ROWS, MAX_PTY_ROWS)
  }
}

function normalizePtyInput(value) {
  if (value === null || value === undefined) {
    return ''
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }

  return String(value)
}

function normalizeClipboardText(value) {
  return value === null || value === undefined ? '' : String(value)
}

function normalizePreviewSpeechPayload(value) {
  const input = isObject(value) ? value : {}

  return {
    text: normalizeClipboardText(input.text)
  }
}

function normalizeSpeechEnabled(value) {
  return Boolean(value)
}

function normalizeUpdateAction(value) {
  return value === 'accept' ? 'accept' : 'dismiss'
}

function normalizeRuntimeLogPayload(value) {
  const input = isObject(value) ? value : {}
  const type = normalizeRuntimeType(input.type)

  return {
    type,
    payload: toJsonSafe(input.payload)
  }
}

function normalizeTranscribePayload(value) {
  const input = isObject(value) ? value : {}
  const audioBuffer = normalizeBinaryPayload(input.audioBuffer)

  if (!audioBuffer.byteLength) {
    throw new Error('Audio buffer is empty.')
  }

  if (audioBuffer.byteLength > MAX_TRANSCRIBE_BYTES) {
    throw new Error('Audio buffer exceeds the supported size limit.')
  }

  return {
    audioBuffer,
    mimeType: normalizeMimeType(input.mimeType)
  }
}

function normalizeBinaryPayload(value) {
  if (!value) {
    throw new Error('Audio buffer is missing.')
  }

  if (Buffer.isBuffer(value)) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value)
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }

  throw new Error('Audio buffer payload is invalid.')
}

function normalizeMimeType(value) {
  const normalized = normalizeClipboardText(value).trim()
  return normalized || DEFAULT_TRANSCRIBE_MIME_TYPE
}

function normalizeRuntimeType(value) {
  const normalized = normalizeClipboardText(value).trim()

  if (!normalized) {
    return 'renderer.event'
  }

  return normalized.slice(0, MAX_RUNTIME_TYPE_LENGTH)
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback
  return Math.min(max, Math.max(min, numeric))
}

function toJsonSafe(value) {
  if (value === undefined) {
    return {}
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_error) {
    return {
      note: 'payload was not JSON-serializable'
    }
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
  normalizeClipboardText,
  normalizePreviewSpeechPayload,
  normalizePtyDimensions,
  normalizePtyInput,
  normalizeRuntimeLogPayload,
  normalizeSpeechEnabled,
  normalizeTranscribePayload,
  normalizeUpdateAction
}
