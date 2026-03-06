const TTS_PROVIDERS = {
  AUTO: 'auto',
  LOCAL: 'local',
  OPENAI: 'openai'
}

function resolveTtsProvider({
  requestedProvider = TTS_PROVIDERS.AUTO,
  hasOpenAiKey = false,
  hasLocalTts = false
}) {
  const provider = normalizeProvider(requestedProvider)

  if (provider === TTS_PROVIDERS.OPENAI) {
    if (!hasOpenAiKey) {
      throw new Error('TTS_PROVIDER=openai was requested, but OPENAI_API_KEY is missing.')
    }

    return TTS_PROVIDERS.OPENAI
  }

  if (provider === TTS_PROVIDERS.LOCAL) {
    if (!hasLocalTts) {
      throw new Error('TTS_PROVIDER=local was requested, but local Windows TTS is unavailable.')
    }

    return TTS_PROVIDERS.LOCAL
  }

  if (hasOpenAiKey) {
    return TTS_PROVIDERS.OPENAI
  }

  if (hasLocalTts) {
    return TTS_PROVIDERS.LOCAL
  }

  throw new Error('No TTS provider is available. Configure OPENAI_API_KEY or run on Windows with local TTS.')
}

function normalizeProvider(value) {
  const normalized = String(value || TTS_PROVIDERS.AUTO).trim().toLowerCase()

  if (Object.values(TTS_PROVIDERS).includes(normalized)) {
    return normalized
  }

  return TTS_PROVIDERS.AUTO
}

module.exports = {
  TTS_PROVIDERS,
  resolveTtsProvider
}
