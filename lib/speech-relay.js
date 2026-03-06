const crypto = require('node:crypto')
const { CodexSpeechInterceptor } = require('./codex-speech-interceptor')
const { TTS_PROVIDERS } = require('./tts-provider-selection')

class SpeechRelay {
  constructor({ ttsService, send, createInterceptor }) {
    this.ttsService = ttsService
    this.send = send
    this.speechQueue = Promise.resolve()
    const buildInterceptor =
      createInterceptor || ((onFinalizedText) => new CodexSpeechInterceptor(onFinalizedText))

    this.interceptor = buildInterceptor((spokenText) => {
      this.queueSpeech(spokenText)
    })
  }

  observeInput(data) {
    this.interceptor.observeInput(data)
  }

  observeOutput(data) {
    this.interceptor.observeOutput(data)
  }

  async flush() {
    this.interceptor.flush()
    await this.speechQueue
  }

  dispose() {
    this.interceptor.dispose()
  }

  queueSpeech(text) {
    const messageId = crypto.randomUUID()

    this.send('speech:finalized', {
      id: messageId,
      text
    })

    this.speechQueue = this.speechQueue
      .then(async () => {
        const audioPayload = await this.ttsService.synthesizeSpeech(text)

        if (!audioPayload?.audioBuffer) {
          return
        }

        if (audioPayload.fallbackFrom === TTS_PROVIDERS.OPENAI) {
          this.send('app:status', {
            message: 'OpenAI TTS was unavailable. Using local Windows voice.'
          })
        }

        this.send('speech:audio', {
          id: messageId,
          audioBase64: audioPayload.audioBuffer.toString('base64'),
          mimeType: audioPayload.mimeType,
          provider: audioPayload.provider,
          text
        })
      })
      .catch((error) => {
        this.send('app:error', {
          message: error instanceof Error ? error.message : String(error)
        })
      })

    return this.speechQueue
  }
}

module.exports = {
  SpeechRelay
}
