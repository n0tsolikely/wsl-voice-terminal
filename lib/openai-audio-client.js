const PLACEHOLDER_API_KEY_PATTERNS = [
  /^your(?:[_-]?openai)?[_-]?api[_-]?key(?:[_-]?here)?$/i,
  /^your[_-]?key(?:[_-]?here)?$/i,
  /^replace(?:[_-]?me|[_-]?with.+)?$/i,
  /^change[_-]?me$/i,
  /^none$/i,
  /^null$/i,
  /^undefined$/i
]

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
    this.sessionDisabledReason = ''
    this.transcriptionModel = transcriptionModel
    this.ttsModel = ttsModel
    this.ttsVoice = ttsVoice
    this.ttsFormat = ttsFormat
    this.maxTtsChars = maxTtsChars
  }

  hasApiKey() {
    return this.getApiKeyState().available
  }

  getApiKeyState() {
    if (this.sessionDisabledReason) {
      return {
        available: false,
        reason: this.sessionDisabledReason
      }
    }

    const normalizedKey = normalizeApiKeyValue(this.apiKeyValue)

    if (!normalizedKey) {
      return {
        available: false,
        reason: 'missing'
      }
    }

    if (isPlaceholderApiKey(normalizedKey)) {
      return {
        available: false,
        reason: 'placeholder'
      }
    }

    return {
      available: true,
      reason: 'configured'
    }
  }

  disableForSession(reason = 'disabled') {
    this.sessionDisabledReason = reason
  }

  get apiKey() {
    const apiKeyState = this.getApiKeyState()

    if (!apiKeyState.available) {
      throw new Error(getApiKeyUnavailableMessage(apiKeyState.reason))
    }

    return normalizeApiKeyValue(this.apiKeyValue)
  }

  async transcribeAudio(audioBuffer, mimeType) {
    const fileBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
    const fileBlob = new Blob([fileBuffer], { type: mimeType || 'audio/webm' })
    const form = new FormData()

    form.set('file', fileBlob, this.buildFilename(mimeType))
    form.set('model', this.transcriptionModel)
    form.set('response_format', 'json')

    try {
      const response = await fetch(`${this.apiBase}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        body: form
      })

      if (!response.ok) {
        throw await buildApiRequestError('Whisper', response)
      }

      const payload = await response.json()

      return typeof payload.text === 'string' ? payload.text.trim() : ''
    } catch (error) {
      this.noteRequestFailure(error)
      throw error
    }
  }

  async synthesizeSpeech(text) {
    const speechInput = text.trim().slice(0, this.maxTtsChars)

    if (!speechInput) {
      return null
    }

    try {
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
        throw await buildApiRequestError('TTS', response)
      }

      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      this.noteRequestFailure(error)
      throw error
    }
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

  noteRequestFailure(error) {
    if (isInvalidApiKeyError(error)) {
      this.disableForSession('auth-failed')
    }
  }
}

function normalizeApiKeyValue(value) {
  return String(value || '').trim()
}

function isPlaceholderApiKey(value) {
  return PLACEHOLDER_API_KEY_PATTERNS.some((pattern) => pattern.test(normalizeApiKeyValue(value)))
}

function getApiKeyUnavailableMessage(reason) {
  if (reason === 'placeholder') {
    return 'OPENAI_API_KEY is not configured.'
  }

  if (reason === 'auth-failed') {
    return 'OPENAI_API_KEY was rejected by OpenAI for this session.'
  }

  return 'OPENAI_API_KEY is missing.'
}

async function buildApiRequestError(label, response) {
  const rawBody = await response.text()
  const parsedBody = parseJson(rawBody)
  const apiMessage = parsedBody?.error?.message || rawBody || 'Request failed.'
  const error = new Error(`${label} request failed with ${response.status}: ${apiMessage}`)

  error.status = response.status
  error.code = parsedBody?.error?.code || ''
  error.body = rawBody
  error.isAuthError = response.status === 401 || error.code === 'invalid_api_key'

  return error
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch (_error) {
    return null
  }
}

function isInvalidApiKeyError(error) {
  if (!error) {
    return false
  }

  if (error.isAuthError || error.status === 401 || error.code === 'invalid_api_key') {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)

  return /(?:incorrect api key|invalid api key|invalid_api_key|unauthorized|authentication|401)/i.test(
    message
  )
}

module.exports = {
  OpenAiAudioClient,
  isInvalidApiKeyError,
  isPlaceholderApiKey
}
