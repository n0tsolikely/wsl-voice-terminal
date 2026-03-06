(function bootstrapDictationBuffer(root) {
  function createDictationBuffer() {
    return {
      committedText: '',
      interimValue: ''
    }
  }

  function appendCommittedDictation(buffer, text) {
    const normalized = normalizeDictationText(text)

    if (!normalized) {
      return { buffer, insertText: '' }
    }

    const insertText = formatDictationChunk(normalized, {
      needsLeadingSpace: Boolean(buffer.committedText)
    })

    return {
      buffer: {
        ...buffer,
        committedText: buffer.committedText + insertText
      },
      insertText
    }
  }

  function replaceInterimDictation(buffer, nextText) {
    const normalized = normalizeDictationText(nextText)

    if (normalized === buffer.interimValue) {
      return { buffer, eraseText: '', insertText: '' }
    }

    const eraseText = buildBackspaceSequence(getRenderedInterimText(buffer).length)

    if (!normalized) {
      return {
        buffer: {
          ...buffer,
          interimValue: ''
        },
        eraseText,
        insertText: ''
      }
    }

    const insertText = formatDictationChunk(normalized, {
      needsLeadingSpace: Boolean(buffer.committedText)
    })

    return {
      buffer: {
        ...buffer,
        interimValue: normalized
      },
      eraseText,
      insertText
    }
  }

  function commitInterimDictation(buffer) {
    const interimText = getRenderedInterimText(buffer)

    if (!interimText) {
      return { buffer, committedText: '' }
    }

    return {
      buffer: {
        committedText: buffer.committedText + interimText,
        interimValue: ''
      },
      committedText: interimText
    }
  }

  function clearInterimDictation(buffer) {
    const renderedInterim = getRenderedInterimText(buffer)

    if (!renderedInterim) {
      return { buffer, eraseText: '' }
    }

    return {
      buffer: {
        ...buffer,
        interimValue: ''
      },
      eraseText: buildBackspaceSequence(renderedInterim.length)
    }
  }

  function consumeTerminalInput(buffer, data) {
    if (!data) {
      return { buffer, eraseText: '' }
    }

    if (data.includes('\u0003')) {
      const { eraseText } = clearInterimDictation(buffer)

      return {
        buffer: createDictationBuffer(),
        eraseText
      }
    }

    if (data.includes('\r') || data.includes('\n')) {
      return {
        buffer: createDictationBuffer(),
        eraseText: ''
      }
    }

    return { buffer, eraseText: '' }
  }

  function getRenderedInterimText(buffer) {
    if (!buffer.interimValue) {
      return ''
    }

    return formatDictationChunk(buffer.interimValue, {
      needsLeadingSpace: Boolean(buffer.committedText)
    })
  }

  function normalizeDictationText(text) {
    return String(text || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  function formatDictationChunk(text, { needsLeadingSpace = false } = {}) {
    const normalized = normalizeDictationText(text)

    if (!normalized) {
      return ''
    }

    return `${needsLeadingSpace ? ' ' : ''}${normalized}`
  }

  function appendWords(base, addition) {
    const normalizedBase = normalizeDictationText(base)
    const normalizedAddition = normalizeDictationText(addition)

    if (!normalizedAddition) {
      return normalizedBase
    }

    if (!normalizedBase) {
      return normalizedAddition
    }

    return `${normalizedBase} ${normalizedAddition}`
  }

  function buildBackspaceSequence(length) {
    return '\u007f'.repeat(length)
  }

  const api = {
    appendCommittedDictation,
    appendWords,
    clearInterimDictation,
    commitInterimDictation,
    consumeTerminalInput,
    createDictationBuffer,
    formatDictationChunk,
    getRenderedInterimText,
    normalizeDictationText,
    replaceInterimDictation
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalDictationBuffer = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
