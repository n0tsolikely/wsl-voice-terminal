const test = require('node:test')
const assert = require('node:assert/strict')

const { MIC_MODES, shouldConsumeEnterForMic } = require('../mic-controls')

test('consumes Enter while toggle recording is active', () => {
  assert.equal(
    shouldConsumeEnterForMic({
      eventType: 'keydown',
      key: 'Enter',
      micMode: MIC_MODES.TOGGLE,
      isRecording: true
    }),
    true
  )
})

test('consumes Enter while auto mode is transcribing', () => {
  assert.equal(
    shouldConsumeEnterForMic({
      eventType: 'keydown',
      key: 'Enter',
      micMode: MIC_MODES.AUTO,
      isTranscribing: true
    }),
    true
  )
})

test('consumes Enter while capture is stopping so it does not leak into the PTY', () => {
  assert.equal(
    shouldConsumeEnterForMic({
      eventType: 'keydown',
      key: 'Enter',
      micMode: MIC_MODES.TOGGLE,
      isStoppingRecording: true
    }),
    true
  )
})

test('does not consume non-Enter keys or hold mode', () => {
  assert.equal(
    shouldConsumeEnterForMic({
      eventType: 'keydown',
      key: 'A',
      micMode: MIC_MODES.TOGGLE,
      isRecording: true
    }),
    false
  )

  assert.equal(
    shouldConsumeEnterForMic({
      eventType: 'keydown',
      key: 'Enter',
      micMode: MIC_MODES.HOLD,
      isRecording: true
    }),
    false
  )
})
