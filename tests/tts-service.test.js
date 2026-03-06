const test = require('node:test')
const assert = require('node:assert/strict')

const { TtsService } = require('../lib/tts-service')
const { TTS_PROVIDERS } = require('../lib/tts-provider-selection')

test('uses OpenAI TTS when requested provider resolves to openai', async () => {
  const service = new TtsService({
    requestedProvider: TTS_PROVIDERS.AUTO,
    openAiAudioClient: {
      hasApiKey: () => true,
      synthesizeSpeech: async () => Buffer.from('mp3')
    },
    localTtsClient: {
      isAvailable: () => true,
      synthesizeSpeech: async () => Buffer.from('wav')
    }
  })

  const result = await service.synthesizeSpeech('hello')

  assert.equal(result.provider, TTS_PROVIDERS.OPENAI)
  assert.equal(result.mimeType, 'audio/mpeg')
  assert.equal(result.audioBuffer.toString(), 'mp3')
})

test('falls back to local TTS when no OpenAI key exists', async () => {
  const service = new TtsService({
    requestedProvider: TTS_PROVIDERS.AUTO,
    openAiAudioClient: {
      hasApiKey: () => false,
      synthesizeSpeech: async () => Buffer.from('mp3')
    },
    localTtsClient: {
      isAvailable: () => true,
      synthesizeSpeech: async () => Buffer.from('wav')
    }
  })

  const result = await service.synthesizeSpeech('hello')

  assert.equal(result.provider, TTS_PROVIDERS.LOCAL)
  assert.equal(result.mimeType, 'audio/wav')
  assert.equal(result.audioBuffer.toString(), 'wav')
})
