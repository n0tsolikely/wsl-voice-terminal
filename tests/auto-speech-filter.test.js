const test = require('node:test')
const assert = require('node:assert/strict')

const { evaluateAutoTranscript, isLikelyNoiseHallucination } = require('../lib/auto-speech-filter')

test('recognizes common silence hallucination phrases', () => {
  assert.equal(isLikelyNoiseHallucination('thank you'), true)
  assert.equal(isLikelyNoiseHallucination('thank you very much'), true)
  assert.equal(isLikelyNoiseHallucination('thanks for watching'), true)
  assert.equal(isLikelyNoiseHallucination('bye'), true)
  assert.equal(isLikelyNoiseHallucination('bye-bye!'), true)
  assert.equal(isLikelyNoiseHallucination('actual useful sentence'), false)
})

test('rejects low-activity short auto transcripts that look like silence hallucinations', () => {
  const verdict = evaluateAutoTranscript('thank you', {
    voiceMs: 40,
    peakLevel: 0.009
  })

  assert.equal(verdict.accepted, false)
  assert.equal(verdict.reason, 'low-activity-short')
})

test('rejects short cjk auto transcripts when there is almost no voice activity', () => {
  const verdict = evaluateAutoTranscript('谢谢', {
    voiceMs: 55,
    peakLevel: 0.008
  })

  assert.equal(verdict.accepted, false)
  assert.match(verdict.reason, /low-activity-short|likely-hallucination/)
})

test('accepts short real auto transcripts when there is clear voice activity', () => {
  const verdict = evaluateAutoTranscript('thank you', {
    voiceMs: 620,
    peakLevel: 0.052
  })

  assert.equal(verdict.accepted, true)
  assert.equal(verdict.normalizedText, 'thank you')
})

test('rejects longer filler closings when there is almost no voice activity', () => {
  const verdict = evaluateAutoTranscript('thank you very much for watching', {
    voiceMs: 65,
    peakLevel: 0.01
  })

  assert.equal(verdict.accepted, false)
  assert.equal(verdict.reason, 'likely-hallucination')
})
