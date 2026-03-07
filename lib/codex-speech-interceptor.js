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
    this.idleMs = options.idleMs || 850
    this.logger = options.logger || null
    this.reset()
  }

  reset() {
    this.activeAssistant = null
    this.awaitingInteractiveAssistant = null
    this.pendingResponse = false
    this.inputBuffer = ''
    this.lastSubmittedInput = ''
    this.lastPromptHint = ''
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
        const launchedAssistant = this.detectAssistantCommand(submitted)

        if (launchedAssistant) {
          if (this.activeAssistant && this.activeAssistant !== launchedAssistant.name) {
            this.pendingResponse = false
            this.captureBuffer = ''
            this.lastSubmittedInput = ''
            this.sawAltScreenExit = false
          }

          this.activeAssistant = launchedAssistant.name
          this.awaitingInteractiveAssistant = launchedAssistant.interactive
            ? launchedAssistant.name
            : null
        }

        if (this.activeAssistant && !this.awaitingInteractiveAssistant) {
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
    const surfacedAssistant = this.detectAssistantSurface(plainChunk)

    if (surfacedAssistant) {
      this.activeAssistant = surfacedAssistant

      if (this.awaitingInteractiveAssistant === surfacedAssistant) {
        this.awaitingInteractiveAssistant = null
      }
    }

    this.capturePromptHint(plainChunk)

    if (this.awaitingInteractiveAssistant) {
      return
    }

    if (!this.activeAssistant || !this.pendingResponse) {
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
    let candidateLines = [...lines]
    let boundaryLines = [...lines]

    while (candidateLines.length && this.lastSubmittedInput) {
      const firstLine = candidateLines[0].trim()
      const boundaryFirstLine = boundaryLines[0]?.trim() || ''
      let removedLine = false

      if (firstLine && firstLine.includes(this.lastSubmittedInput)) {
        candidateLines.shift()
        removedLine = true
      }

      if (boundaryFirstLine && boundaryFirstLine.includes(this.lastSubmittedInput)) {
        boundaryLines.shift()
        removedLine = true
      }

      if (removedLine) {
        continue
      }

      break
    }

    while (boundaryLines.length && this.isFooterLine(boundaryLines[boundaryLines.length - 1])) {
      boundaryLines.pop()
    }

    const lastLine = getLastNonEmptyLine(boundaryLines)

    while (
      candidateLines.length &&
      this.isFooterLine(candidateLines[candidateLines.length - 1]) &&
      !extractSpeechText(candidateLines[candidateLines.length - 1])
    ) {
      candidateLines.pop()
    }

    candidateLines = candidateLines.filter((line) => !this.isStoredPromptHintLine(line))
    candidateLines = candidateLines.filter((line) => !this.isEchoedSubmittedInputLine(line))
    candidateLines = candidateLines.filter((line) => !this.isEchoedDraftInputLine(line))

    while (candidateLines.length && this.isPromptLine(candidateLines[candidateLines.length - 1])) {
      candidateLines.pop()
    }

    const spokenText = extractSpeechText(candidateLines.join('\n'))
    const boundary = this.getCompletionBoundaryState({
      lines: boundaryLines,
      rawLines: lines,
      lastLine,
      spokenText
    })

    this.logDebug('speech.analysis', {
      activeAssistant: this.activeAssistant || '',
      pendingResponse: this.pendingResponse,
      lastSubmittedInput: summarizeForLog(this.lastSubmittedInput),
      currentDraftInput: summarizeForLog(this.inputBuffer),
      lastPromptHint: summarizeForLog(this.lastPromptHint),
      lastLine: summarizeForLog(lastLine),
      spokenText: summarizeForLog(spokenText),
      candidateLines: candidateLines.slice(-6).map((line) => summarizeForLog(line)),
      boundary
    })

    if (this.isCurrentDraftText(spokenText)) {
      this.logDebug('speech.analysis_rejected', {
        reason: 'draft-echo',
        spokenText: summarizeForLog(spokenText),
        currentDraftInput: summarizeForLog(this.inputBuffer)
      })
      return null
    }

    if (!boundary.complete) {
      this.logDebug('speech.analysis_rejected', {
        reason: 'no-boundary',
        spokenText: summarizeForLog(spokenText),
        boundary
      })
      return null
    }

    this.pendingResponse = false
    this.captureBuffer = ''
    this.sawAltScreenExit = false

    if (this.isShellPrompt(lastLine)) {
      this.activeAssistant = null
    }

    if (!spokenText || spokenText === this.lastEmittedText) {
      return null
    }

    this.lastEmittedText = spokenText
    this.logDebug('speech.analysis_finalized', {
      spokenText: summarizeForLog(spokenText),
      boundary
    })
    this.onFinalizedText(spokenText)

    return spokenText
  }

  hasCompletionBoundary({ lines, rawLines, lastLine, spokenText }) {
    return this.getCompletionBoundaryState({
      lines,
      rawLines,
      lastLine,
      spokenText
    }).complete
  }

  getCompletionBoundaryState({ lines, rawLines, lastLine, spokenText }) {
    if (!spokenText) {
      return {
        complete: false,
        shellPrompt: false,
        claudePromptReturn: false,
        assistantPrompt: false,
        codexTrailingSpeech: false,
        altScreenExit: Boolean(this.sawAltScreenExit)
      }
    }

    const shellPrompt = this.isShellPrompt(lastLine)
    const claudePromptReturn =
      this.activeAssistant === 'claude' && this.hasClaudePromptReturn(rawLines || lines)
    const assistantPrompt = this.isAssistantPrompt(lastLine)
    const codexTrailingSpeech = this.hasCodexTrailingSpeechAfterPrompt(rawLines || lines)
    const altScreenExit = Boolean(this.sawAltScreenExit)

    return {
      complete:
        shellPrompt ||
        claudePromptReturn ||
        assistantPrompt ||
        codexTrailingSpeech ||
        altScreenExit,
      shellPrompt,
      claudePromptReturn,
      assistantPrompt,
      codexTrailingSpeech,
      altScreenExit
    }
  }

  logDebug(type, payload) {
    this.logger?.log(type, payload, {
      component: 'speech-interceptor'
    })
  }

  isPromptLine(line) {
    return this.isAssistantPrompt(line) || this.isShellPrompt(line)
  }

  isStoredPromptHintLine(line) {
    if (!this.lastPromptHint) {
      return false
    }

    return normalizePromptText(line) === this.lastPromptHint
  }

  isEchoedSubmittedInputLine(line) {
    const submitted = normalizeComparableText(this.lastSubmittedInput)
    const candidate = normalizeComparableText(stripPromptPrefix(line))

    if (!submitted || !candidate) {
      return false
    }

    return candidate === submitted
  }

  isEchoedDraftInputLine(line) {
    const draft = normalizeComparableText(this.inputBuffer)
    const candidate = normalizeComparableText(stripPromptPrefix(line))

    if (!draft || !candidate) {
      return false
    }

    return candidate === draft
  }

  isCurrentDraftText(text) {
    const draft = normalizeComparableText(this.inputBuffer)
    const candidate = normalizeComparableText(text)

    if (!draft || !candidate) {
      return false
    }

    return candidate === draft
  }

  isAssistantPrompt(line) {
    if (this.activeAssistant === 'claude') {
      return this.isClaudePrompt(line)
    }

    return this.isCodexPrompt(line)
  }

  isCodexPrompt(line) {
    return /^(?:(?:>|>>|›|»|❯)(?:\s*.*)?|(?:You:|User:|Human:|Prompt:)\s*)$/.test(
      String(line || '').trim()
    )
  }

  isCodexFooterLine(line) {
    const trimmed = String(line || '').trim()

    return (
      /\bcontext left\b/i.test(trimmed) ||
      (/\b\d+%\s+left\b/i.test(trimmed) && /[\\/]/.test(trimmed)) ||
      /^(?:model|directory)\s*:/i.test(trimmed) ||
      /\/(?:ps|clean|model)\b/i.test(trimmed)
    )
  }

  isClaudePrompt(line) {
    return /^❯(?:[\s\u00a0].*)?$/.test(String(line || '').trim())
  }

  isClaudeFooterLine(line) {
    const trimmed = String(line || '').trim()

    return /^\?\s+for shortcuts\b/i.test(trimmed) || this.isSeparatorLine(trimmed)
  }

  isFooterLine(line) {
    return this.activeAssistant === 'claude'
      ? this.isClaudeFooterLine(line)
      : this.isCodexFooterLine(line)
  }

  isSeparatorLine(line) {
    return /^[─━-]{10,}(?:\s+[▪•]+(?:\s+[─━-]+)?)?$/.test(String(line || '').trim())
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

  looksLikeClaudeSurface(text) {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    return (
      lines.some((line) => /\bClaude Code\b/i.test(line)) ||
      lines.some((line) => this.isClaudePrompt(line)) ||
      lines.some((line) => /^\?\s+for shortcuts\b/i.test(line))
    )
  }

  hasClaudePromptReturn(lines) {
    const tail = lines
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(-8)
    let promptIndex = -1
    let shortcutsIndex = -1

    for (let index = 0; index < tail.length; index += 1) {
      if (this.isClaudePrompt(tail[index])) {
        promptIndex = index
      }

      if (/^\?\s+for shortcuts\b/i.test(tail[index])) {
        shortcutsIndex = index
      }
    }

    return promptIndex !== -1 && shortcutsIndex !== -1 && promptIndex < shortcutsIndex
  }

  hasCodexTrailingSpeechAfterPrompt(lines) {
    const tail = (lines || [])
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(-12)
    let promptIndex = -1

    for (let index = tail.length - 1; index >= 0; index -= 1) {
      if (this.isCodexPrompt(tail[index])) {
        promptIndex = index
        break
      }
    }

    if (promptIndex === -1) {
      return false
    }

    const trailingLines = tail
      .slice(promptIndex + 1)
      .filter((line) => line && !this.isCodexFooterLine(line))

    return trailingLines.length > 0 && trailingLines.every((line) => Boolean(extractSpeechText(line)))
  }

  detectAssistantCommand(submitted) {
    if (/^codex(?:\s|$)/i.test(submitted)) {
      return {
        name: 'codex',
        interactive: !/^codex\s+exec(?:\s|$)/i.test(submitted)
      }
    }

    if (/^claude(?:\s|$)/i.test(submitted)) {
      return {
        name: 'claude',
        interactive: !/^claude\s+(?:-p|--print)(?:\s|$)/i.test(submitted)
      }
    }

    return null
  }

  detectAssistantSurface(text) {
    if (this.looksLikeCodexSurface(text)) {
      return 'codex'
    }

    if (this.looksLikeClaudeSurface(text)) {
      return 'claude'
    }

    return null
  }

  isShellPrompt(line) {
    const trimmed = String(line || '').trim()

    return (
      /^[^@\s]+@[^:\s]+:[^#$\n]+[$#]\s*$/.test(trimmed) ||
      /^PS [^>]+>\s*$/.test(trimmed) ||
      /^[A-Za-z]:\\.*>\s*$/.test(trimmed)
    )
  }

  capturePromptHint(text) {
    if (this.activeAssistant !== 'codex' && !this.looksLikeCodexSurface(text)) {
      return
    }

    const lines = String(text || '')
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter(Boolean)

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const rawLine = lines[index]
      const candidate = normalizePromptText(rawLine)

      if (this.isCodexPrompt(rawLine) && candidate && !this.isLikelySubmittedPrompt(candidate)) {
        this.lastPromptHint = candidate
        return
      }
    }
  }

  isLikelySubmittedPrompt(line) {
    if (!this.lastSubmittedInput) {
      return false
    }

    return normalizePromptText(line) === normalizePromptText(this.lastSubmittedInput)
  }
}

function normalizePromptText(line) {
  return String(line || '')
    .trim()
    .replace(/^(?:>|>>|›|»|❯)\s*/, '')
    .replace(/^(?:You:|User:|Human:|Prompt:)\s*/i, '')
    .trim()
}

function stripPromptPrefix(line) {
  return String(line || '')
    .trim()
    .replace(/^(?:>|>>|›|»|❯)\s*/, '')
    .replace(/^(?:You|User|Human|Prompt):\s*/i, '')
    .trim()
}

function normalizeComparableText(text) {
  return String(text || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function summarizeForLog(value, maxLength = 220) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return ''
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}…`
}

module.exports = {
  CodexSpeechInterceptor
}
