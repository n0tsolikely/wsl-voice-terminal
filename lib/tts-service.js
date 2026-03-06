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
      try {
        const audioBuffer = await this.openAiAudioClient.synthesizeSpeech(text)

        return audioBuffer
          ? {
              audioBuffer,
              mimeType: 'audio/mpeg',
              provider
            }
          : null
      } catch (error) {
        if (
          this.requestedProvider !== TTS_PROVIDERS.AUTO ||
          !this.localTtsClient.isAvailable() ||
          !shouldFallbackToLocal(error)
        ) {
          throw error
        }

        const audioBuffer = await this.localTtsClient.synthesizeSpeech(text)

        return audioBuffer
          ? {
              audioBuffer,
              mimeType: 'audio/wav',
              provider: TTS_PROVIDERS.LOCAL,
              fallbackFrom: TTS_PROVIDERS.OPENAI
            }
          : null
      }
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

function shouldFallbackToLocal(error) {
  const message = error instanceof Error ? error.message : String(error)

  return /(?:failed to fetch|fetch failed|network|socket|timed out|timeout|econn|enotfound|offline|502|503|504|401|incorrect api key|invalid api key|invalid_api_key|unauthorized|authentication)/i.test(
    message
  )
}

module.exports = {
  TtsService
}
