(function attachAutoSpeechFilter(root) {
  function evaluateAutoTranscript(text, metrics = {}, options = {}) {
    const normalizedText = normalizeAutoText(text)
    const minVoiceMs = Number.isFinite(options.minVoiceMs) ? options.minVoiceMs : 180
    const minPeakLevel = Number.isFinite(options.minPeakLevel) ? options.minPeakLevel : 0.026
    const strongVoiceMs = Number.isFinite(options.strongVoiceMs) ? options.strongVoiceMs : 420
    const strongPeakLevel = Number.isFinite(options.strongPeakLevel)
      ? options.strongPeakLevel
      : Math.max(0.04, minPeakLevel * 1.45)
    const voiceMs = Number.isFinite(metrics.voiceMs) ? metrics.voiceMs : 0
    const peakLevel = Number.isFinite(metrics.peakLevel) ? metrics.peakLevel : 0
    const hasMeaningfulVoice = voiceMs >= minVoiceMs || peakLevel >= minPeakLevel
    const hasStrongVoice = voiceMs >= strongVoiceMs || peakLevel >= strongPeakLevel
    const wordCount = normalizedText ? normalizedText.split(/\s+/).filter(Boolean).length : 0

    if (!normalizedText) {
      return {
        accepted: false,
        normalizedText: '',
        reason: 'empty'
      }
    }

    if (!hasMeaningfulVoice && wordCount <= 4) {
      return {
        accepted: false,
        normalizedText,
        reason: 'low-activity-short'
      }
    }

    if (isLikelyNoiseHallucination(normalizedText) && !hasStrongVoice) {
      return {
        accepted: false,
        normalizedText,
        reason: 'likely-hallucination'
      }
    }

    return {
      accepted: true,
      normalizedText,
      reason: 'accepted'
    }
  }

  function isLikelyNoiseHallucination(text) {
    const normalized = normalizeAutoText(text)

    if (!normalized) {
      return false
    }

    if (
      /^(?:thank you|thanks|thanks for watching|thank you for watching|bye|bye bye|goodbye|good bye|see you|see you later|ok|okay)$/.test(
        normalized
      )
    ) {
      return true
    }

    if (!/[a-z]/i.test(normalized) && /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(normalized)) {
      return normalized.length <= 12
    }

    return false
  }

  function normalizeAutoText(text) {
    return String(text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  }

  const api = {
    evaluateAutoTranscript,
    isLikelyNoiseHallucination
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalAutoSpeechFilter = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
