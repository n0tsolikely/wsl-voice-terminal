const test = require('node:test')
const assert = require('node:assert/strict')

const {
  OpenAiAudioClient,
  isInvalidApiKeyError,
  isPlaceholderApiKey
} = require('../lib/openai-audio-client')

test('placeholder API keys are treated as missing', () => {
  const client = new OpenAiAudioClient({
    apiBase: 'https://example.com',
    apiKey: 'your_key_here'
  })

  assert.equal(isPlaceholderApiKey('your_key_here'), true)
  assert.equal(client.hasApiKey(), false)
  assert.equal(client.getApiKeyState().reason, 'placeholder')
})

test('invalid OpenAI auth disables the audio client for the session', async () => {
  const originalFetch = global.fetch

  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () =>
      JSON.stringify({
        error: {
          message: 'Incorrect API key provided.',
          code: 'invalid_api_key'
        }
      })
  })

  const client = new OpenAiAudioClient({
    apiBase: 'https://example.com',
    apiKey: 'sk-test'
  })

  try {
    await assert.rejects(
      () => client.transcribeAudio(Buffer.from('voice'), 'audio/webm'),
      /Incorrect API key provided/
    )
  } finally {
    global.fetch = originalFetch
  }

  assert.equal(client.hasApiKey(), false)
  assert.equal(client.getApiKeyState().reason, 'auth-failed')
  assert.equal(
    isInvalidApiKeyError(new Error('TTS request failed with 401: Incorrect API key provided.')),
    true
  )
})
