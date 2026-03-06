const { TTS_PROVIDERS, resolveTtsProvider } = require('./tts-provider-selection')

class TtsService {
  constructor({ requestedProvider, openAiAudioClient, localTtsClient }) {
    this.requestedProvider = requestedProvider
    this.openAiAudioClient = openAiAudioClient
    this.localTtsClient = localTtsClient
  }

  async synthesizeSpeech(text) {
    const provider = resolveTtsProvider({
      requestedProvider: this.requestedProvider,
      hasOpenAiKey: this.openAiAudioClient.hasApiKey(),
      hasLocalTts: this.localTtsClient.isAvailable()
    })

    if (provider === TTS_PROVIDERS.OPENAI) {
      const audioBuffer = await this.openAiAudioClient.synthesizeSpeech(text)

      return audioBuffer
        ? {
            audioBuffer,
            mimeType: 'audio/mpeg',
            provider
          }
        : null
    }

    const audioBuffer = await this.localTtsClient.synthesizeSpeech(text)

    return audioBuffer
      ? {
          audioBuffer,
          mimeType: 'audio/wav',
          provider
        }
      : null
  }
}

module.exports = {
  TtsService
}
