const { CodexSpeechInterceptor } = require('./codex-speech-interceptor')

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
    this.speechQueue = this.speechQueue
      .then(async () => {
        const audioPayload = await this.ttsService.synthesizeSpeech(text)

        if (!audioPayload?.audioBuffer) {
          return
        }

        this.send('speech:audio', {
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
