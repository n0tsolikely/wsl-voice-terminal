const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeClipboardText,
  normalizePreviewSpeechPayload,
  normalizePtyDimensions,
  normalizePtyInput,
  normalizeRuntimeLogPayload,
  normalizeSpeechEnabled,
  normalizeTranscribePayload,
  normalizeUpdateAction
} = require('../lib/ipc-contracts')

test('normalizePtyDimensions clamps invalid values to a safe range', () => {
  const result = normalizePtyDimensions({
    cols: 9999,
    rows: 1
  })

  assert.deepEqual(result, {
    cols: 400,
    rows: 8
  })
})

test('normalizePtyInput and normalizeClipboardText always return strings', () => {
  assert.equal(normalizePtyInput(Buffer.from('hello')), 'hello')
  assert.equal(normalizePtyInput(null), '')
  assert.equal(normalizeClipboardText(42), '42')
})

test('normalizePreviewSpeechPayload keeps the speech preview contract narrow', () => {
  assert.deepEqual(normalizePreviewSpeechPayload({ text: 123 }), {
    text: '123'
  })
})

test('normalizeTranscribePayload accepts typed-array audio buffers and defaults mime type', () => {
  const audioBuffer = new Uint8Array([1, 2, 3, 4])
  const result = normalizeTranscribePayload({
    audioBuffer
  })

  assert.ok(Buffer.isBuffer(result.audioBuffer))
  assert.equal(result.audioBuffer.byteLength, 4)
  assert.equal(result.mimeType, 'audio/webm')
})

test('normalizeTranscribePayload rejects invalid or empty audio payloads', () => {
  assert.throws(() => normalizeTranscribePayload({ audioBuffer: null }), /missing/i)
  assert.throws(
    () => normalizeTranscribePayload({ audioBuffer: new Uint8Array() }),
    /empty/i
  )
  assert.throws(
    () => normalizeTranscribePayload({ audioBuffer: 'not-binary' }),
    /invalid/i
  )
})

test('normalizeRuntimeLogPayload returns a safe default type and JSON-safe payload', () => {
  const circular = {}
  circular.self = circular

  const result = normalizeRuntimeLogPayload({
    type: '',
    payload: circular
  })

  assert.equal(result.type, 'renderer.event')
  assert.deepEqual(result.payload, {
    note: 'payload was not JSON-serializable'
  })
})

test('normalizeUpdateAction and normalizeSpeechEnabled collapse inputs to supported values', () => {
  assert.equal(normalizeUpdateAction('accept'), 'accept')
  assert.equal(normalizeUpdateAction('anything-else'), 'dismiss')
  assert.equal(normalizeSpeechEnabled('yes'), true)
  assert.equal(normalizeSpeechEnabled(0), false)
})
