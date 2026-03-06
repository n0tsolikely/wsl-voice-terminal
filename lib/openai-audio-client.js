class OpenAiAudioClient {
  constructor({
    apiBase,
    apiKey = process.env.OPENAI_API_KEY || '',
    transcriptionModel = 'whisper-1',
    ttsModel = 'tts-1',
    ttsVoice = 'alloy',
    ttsFormat = 'mp3',
    maxTtsChars = 4000
  }) {
    this.apiBase = apiBase
    this.apiKeyValue = apiKey
    this.transcriptionModel = transcriptionModel
    this.ttsModel = ttsModel
    this.ttsVoice = ttsVoice
    this.ttsFormat = ttsFormat
    this.maxTtsChars = maxTtsChars
  }

  hasApiKey() {
    return Boolean(this.apiKeyValue && this.apiKeyValue.trim())
  }

  get apiKey() {
    if (!this.hasApiKey()) {
      throw new Error('OPENAI_API_KEY is missing.')
    }

    return this.apiKeyValue
  }

  async transcribeAudio(audioBuffer, mimeType) {
    const fileBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
    const fileBlob = new Blob([fileBuffer], { type: mimeType || 'audio/webm' })
    const form = new FormData()

    form.set('file', fileBlob, this.buildFilename(mimeType))
    form.set('model', this.transcriptionModel)
    form.set('response_format', 'json')

    const response = await fetch(`${this.apiBase}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form
    })

    if (!response.ok) {
      throw new Error(`Whisper request failed with ${response.status}: ${await response.text()}`)
    }

    const payload = await response.json()

    return typeof payload.text === 'string' ? payload.text.trim() : ''
  }

  async synthesizeSpeech(text) {
    const speechInput = text.trim().slice(0, this.maxTtsChars)

    if (!speechInput) {
      return null
    }

    const response = await fetch(`${this.apiBase}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.ttsModel,
        voice: this.ttsVoice,
        response_format: this.ttsFormat,
        input: speechInput
      })
    })

    if (!response.ok) {
      throw new Error(`TTS request failed with ${response.status}: ${await response.text()}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  buildFilename(mimeType) {
    const extensionMap = {
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'webm'
    }

    return `recording.${extensionMap[mimeType] || 'webm'}`
  }
}

module.exports = {
  OpenAiAudioClient
}
