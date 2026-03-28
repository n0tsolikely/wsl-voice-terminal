const crypto = require('node:crypto')
const { CodexSpeechInterceptor } = require('./codex-speech-interceptor')
const {
  createSegmentSignature,
  normalizeSegmentKind
} = require('./speech-segments')
const { TTS_PROVIDERS } = require('./tts-provider-selection')

class SpeechRelay {
  constructor({ ttsService, logger = null, send, createInterceptor }) {
    this.ttsService = ttsService
    this.logger = logger
    this.send = send
    this.speechQueue = Promise.resolve()
    this.autoReplySpeechEnabled = true
    this.seenSegmentsByTurn = new Map()
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
    const kind = normalizeSegmentKind(meta.kind)
    const turnId = String(meta.turnId || 'turn-unknown')
    const sequence = Number.isFinite(meta.sequence) ? meta.sequence : 0

    if (!normalizedText) {
      return this.speechQueue
    }

    const signature = createSegmentSignature({
      kind,
      text: normalizedText
    })
    const seenSegments = this.getSeenSegmentsForTurn(turnId)

    if (seenSegments.has(signature)) {
      this.logger?.log('speech.queue_deduped', {
        kind,
        turnId,
        sequence,
        text: normalizedText
      })
      return this.speechQueue
    }

    seenSegments.add(signature)
    const messageId = crypto.randomUUID()
    const payload = {
      id: messageId,
      text: normalizedText,
      kind,
      turnId,
      sequence
    }

    this.logger?.log('speech.finalized', {
      ...payload
    })
    this.send('speech:finalized', payload)

    this.speechQueue = this.speechQueue
      .then(async () => {
        if (!this.autoReplySpeechEnabled) {
          this.logger?.log('speech.audio_skipped', {
            ...payload,
            reason: 'disabled',
          })
          return
        }

        const audioPayload = await this.ttsService.synthesizeSpeech(normalizedText)

        if (!audioPayload?.audioBuffer) {
          return
        }

        if (audioPayload.fallbackFrom === TTS_PROVIDERS.OPENAI) {
          this.logger?.log('speech.fallback', {
            ...payload,
            from: TTS_PROVIDERS.OPENAI,
            to: TTS_PROVIDERS.LOCAL
          })
          this.send('app:status', {
            message: 'OpenAI TTS was unavailable. Using local Windows voice.'
          })
        }

        this.logger?.log('speech.audio', {
          ...payload,
          provider: audioPayload.provider,
          mimeType: audioPayload.mimeType
        })
        this.send('speech:audio', {
          ...payload,
          audioBase64: audioPayload.audioBuffer.toString('base64'),
          mimeType: audioPayload.mimeType,
          provider: audioPayload.provider
        })
      })
      .catch((error) => {
        this.logger?.log('speech.error', {
          ...payload,
          message: error instanceof Error ? error.message : String(error)
        })
        this.send('app:error', {
          message: error instanceof Error ? error.message : String(error)
        })
      })

    return this.speechQueue
  }

  getSeenSegmentsForTurn(turnId) {
    if (!this.seenSegmentsByTurn.has(turnId)) {
      this.seenSegmentsByTurn.set(turnId, new Set())

      while (this.seenSegmentsByTurn.size > 12) {
        const oldestTurnId = this.seenSegmentsByTurn.keys().next().value
        this.seenSegmentsByTurn.delete(oldestTurnId)
      }
    }

    return this.seenSegmentsByTurn.get(turnId)
  }
}

module.exports = {
  SpeechRelay
}
