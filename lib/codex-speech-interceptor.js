const {
  extractSpeechText,
  getLastNonEmptyLine,
  normalizeTerminalText
} = require('./terminal-speech')

class CodexSpeechInterceptor {
  constructor(onFinalizedText, options = {}) {
    this.onFinalizedText = onFinalizedText
    this.schedule = options.schedule || setTimeout
    this.clearScheduled = options.clearScheduled || clearTimeout
    this.idleMs = options.idleMs || 1200
    this.reset()
  }

  reset() {
    this.codexSessionActive = false
    this.pendingResponse = false
    this.inputBuffer = ''
    this.lastSubmittedInput = ''
    this.captureBuffer = ''
    this.lastEmittedText = ''
    this.idleTimer = null
    this.sawAltScreenExit = false
  }

  dispose() {
    if (this.idleTimer) {
      this.clearScheduled(this.idleTimer)
      this.idleTimer = null
    }
  }

  flush() {
    if (this.idleTimer) {
      this.clearScheduled(this.idleTimer)
      this.idleTimer = null
    }

    return this.maybeFinalize()
  }

  observeInput(data) {
    for (const char of data) {
      if (char === '\u0003') {
        this.pendingResponse = false
        this.captureBuffer = ''
        continue
      }

      if (char === '\u007f' || char === '\b') {
        this.inputBuffer = this.inputBuffer.slice(0, -1)
        continue
      }

      if (char === '\r' || char === '\n') {
        const submitted = this.inputBuffer.trim()

        if (/^codex(?:\s|$)/.test(submitted)) {
          this.codexSessionActive = true
        }

        if (this.codexSessionActive) {
          this.pendingResponse = true
          this.captureBuffer = ''
          this.lastSubmittedInput = submitted
        }

        this.inputBuffer = ''
        continue
      }

      if (char >= ' ') {
        this.inputBuffer += char
      }
    }
  }

  observeOutput(chunk) {
    const plainChunk = normalizeTerminalText(chunk, { trimEdges: false })

    if (!this.codexSessionActive && this.looksLikeCodexSurface(plainChunk)) {
      this.codexSessionActive = true
    }

    if (!this.codexSessionActive || !this.pendingResponse) {
      return
    }

    if (chunk.includes('\u001b[?1049l') || chunk.includes('\u001b[?47l')) {
      this.sawAltScreenExit = true
    }

    if (!plainChunk) {
      return
    }

    this.captureBuffer += plainChunk

    if (this.captureBuffer.length > 30000) {
      this.captureBuffer = this.captureBuffer.slice(-30000)
    }

    if (this.idleTimer) {
      this.clearScheduled(this.idleTimer)
    }

    this.idleTimer = this.schedule(() => {
      this.maybeFinalize()
    }, this.idleMs)
  }

  maybeFinalize() {
    const normalized = normalizeTerminalText(this.captureBuffer)

    if (!normalized) {
      return null
    }

    const lines = normalized
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, collection) => !(line === '' && index === collection.length - 1))
    const lastLine = getLastNonEmptyLine(lines)
    let candidateLines = [...lines]

    if (candidateLines.length && this.lastSubmittedInput) {
      const firstLine = candidateLines[0].trim()

      if (firstLine.includes(this.lastSubmittedInput)) {
        candidateLines.shift()
      }
    }

    while (candidateLines.length && this.isPromptLine(candidateLines[candidateLines.length - 1])) {
      candidateLines.pop()
    }

    const spokenText = extractSpeechText(candidateLines.join('\n'))

    if (!this.hasCompletionBoundary({ lastLine, spokenText })) {
      return null
    }

    this.pendingResponse = false
    this.captureBuffer = ''
    this.sawAltScreenExit = false

    if (this.isShellPrompt(lastLine)) {
      this.codexSessionActive = false
    }

    if (!spokenText || spokenText === this.lastEmittedText) {
      return null
    }

    this.lastEmittedText = spokenText
    this.onFinalizedText(spokenText)

    return spokenText
  }

  hasCompletionBoundary({ lastLine, spokenText }) {
    if (this.isPromptLine(lastLine)) {
      return true
    }

    return Boolean(this.sawAltScreenExit && spokenText)
  }

  isPromptLine(line) {
    return this.isCodexPrompt(line) || this.isShellPrompt(line)
  }

  isCodexPrompt(line) {
    return /^(?:>|>>|›|»|❯|You:|User:|Human:|Prompt:)\s*$/.test(String(line || '').trim())
  }

  looksLikeCodexSurface(text) {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const lastLine = getLastNonEmptyLine(lines)

    if (this.isCodexPrompt(lastLine)) {
      return true
    }

    return lines.some((line) => /\b(?:OpenAI\s+)?codex\b/i.test(line))
  }

  isShellPrompt(line) {
    const trimmed = String(line || '').trim()

    return (
      /^[^@\s]+@[^:\s]+:[^#$\n]+[$#]\s*$/.test(trimmed) ||
      /^PS [^>]+>\s*$/.test(trimmed) ||
      /^[A-Za-z]:\\.*>\s*$/.test(trimmed)
    )
  }
}

module.exports = {
  CodexSpeechInterceptor
}
