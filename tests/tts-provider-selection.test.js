const test = require('node:test')
const assert = require('node:assert/strict')

const { TTS_PROVIDERS, resolveTtsProvider } = require('../lib/tts-provider-selection')

test('auto prefers OpenAI when an API key is available', () => {
  assert.equal(
    resolveTtsProvider({
      requestedProvider: TTS_PROVIDERS.AUTO,
      hasOpenAiKey: true,
      hasLocalTts: true
    }),
    TTS_PROVIDERS.OPENAI
  )
})

test('auto falls back to local TTS when no API key is available', () => {
  assert.equal(
    resolveTtsProvider({
      requestedProvider: TTS_PROVIDERS.AUTO,
      hasOpenAiKey: false,
      hasLocalTts: true
    }),
    TTS_PROVIDERS.LOCAL
  )
})

test('explicit local fails clearly when unavailable', () => {
  assert.throws(
    () =>
      resolveTtsProvider({
        requestedProvider: TTS_PROVIDERS.LOCAL,
        hasOpenAiKey: true,
        hasLocalTts: false
      }),
    /local Windows TTS is unavailable/
  )
})

test('explicit openai fails clearly when no key exists', () => {
  assert.throws(
    () =>
      resolveTtsProvider({
        requestedProvider: TTS_PROVIDERS.OPENAI,
        hasOpenAiKey: false,
        hasLocalTts: true
      }),
    /OPENAI_API_KEY is missing/
  )
})
