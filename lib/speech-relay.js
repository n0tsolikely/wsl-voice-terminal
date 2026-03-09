const crypto = require('node:crypto')
const { CodexSpeechInterceptor } = require('./codex-speech-interceptor')
const { TTS_PROVIDERS } = require('./tts-provider-selection')

class SpeechRelay {
  constructor({ ttsService, logger = null, send, createInterceptor }) {
    this.ttsService = ttsService
    this.logger = logger
    this.send = send
    this.speechQueue = Promise.resolve()
    this.autoReplySpeechEnabled = true
    this.pendingReply = null
    const buildInterceptor =
      createInterceptor ||
      ((onFinalizedText) =>
        new CodexSpeechInterceptor(onFinalizedText, {
          logger
        }))

    this.interceptor = buildInterceptor((spokenText, meta = {}) => {
      this.handleSpeechSegment(spokenText, meta)
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

  setAutoReplySpeechEnabled(enabled) {
    this.autoReplySpeechEnabled = Boolean(enabled)
  }

  handleSpeechSegment(text, meta = {}) {
    const normalizedText = String(text || '').trim()

    if (!normalizedText) {
      return this.speechQueue
    }

    if (!this.pendingReply) {
      this.pendingReply = {
        id: crypto.randomUUID(),
        segments: []
      }
    }

    const lastSegment = this.pendingReply.segments[this.pendingReply.segments.length - 1] || ''
    if (normalizedText !== lastSegment) {
      this.pendingReply.segments.push(normalizedText)
    }

    if (meta.continueResponse) {
      return this.speechQueue
    }

    return this.flushPendingReply()
  }

  flushPendingReply() {
    const pendingReply = this.pendingReply
    const text = pendingReply?.segments?.join(' ').replace(/\s{2,}/g, ' ').trim()

    this.pendingReply = null

    if (!text) {
      return this.speechQueue
    }

    const messageId = pendingReply?.id || crypto.randomUUID()

    this.logger?.log('speech.finalized', {
      id: messageId,
      text
    })
    this.send('speech:finalized', {
      id: messageId,
      text
    })

    this.speechQueue = this.speechQueue
      .then(async () => {
        if (!this.autoReplySpeechEnabled) {
          this.logger?.log('speech.audio_skipped', {
            id: messageId,
            reason: 'disabled',
            text
          })
          return
        }

        const audioPayload = await this.ttsService.synthesizeSpeech(text)

        if (!audioPayload?.audioBuffer) {
          return
        }

        if (audioPayload.fallbackFrom === TTS_PROVIDERS.OPENAI) {
          this.logger?.log('speech.fallback', {
            id: messageId,
            from: TTS_PROVIDERS.OPENAI,
            to: TTS_PROVIDERS.LOCAL,
            text
          })
          this.send('app:status', {
            message: 'OpenAI TTS was unavailable. Using local Windows voice.'
          })
        }

        this.logger?.log('speech.audio', {
          id: messageId,
          provider: audioPayload.provider,
          mimeType: audioPayload.mimeType,
          text
        })
        this.send('speech:audio', {
          id: messageId,
          audioBase64: audioPayload.audioBuffer.toString('base64'),
          mimeType: audioPayload.mimeType,
          provider: audioPayload.provider,
          text
        })
      })
      .catch((error) => {
        this.logger?.log('speech.error', {
          id: messageId,
          message: error instanceof Error ? error.message : String(error)
        })
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
