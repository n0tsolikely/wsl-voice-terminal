const {
  extractSpeechText,
  getLastNonEmptyLine,
  isToolProgressLine,
  normalizeTerminalText
} = require('./terminal-speech')

class CodexSpeechInterceptor {
  constructor(onFinalizedText, options = {}) {
    this.onFinalizedText = onFinalizedText
    this.schedule = options.schedule || setTimeout
    this.clearScheduled = options.clearScheduled || clearTimeout
    this.idleMs = options.idleMs || 850
    this.maxCaptureChars = Math.max(8000, options.maxCaptureChars || 30000)
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
    this.lastNoBoundarySpokenText = ''
    this.noBoundaryStablePasses = 0
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
    const sanitizedInput = stripAnsiInputSequences(data)

    for (const char of sanitizedInput) {

      if (char === '\u0003') {
        this.pendingResponse = false
        this.captureBuffer = ''
        this.lastNoBoundarySpokenText = ''
        this.noBoundaryStablePasses = 0
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
            this.lastNoBoundarySpokenText = ''
            this.noBoundaryStablePasses = 0
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

    const transition = detectSpeechTransitionBoundary(plainChunk)

    if (transition) {
      if (transition.leadingText) {
        this.captureBuffer += transition.leadingText
        this.trimCaptureBuffer()
      }

      const finalized = this.captureBuffer
        ? this.maybeFinalize({
            forcedBoundary: transition.kind,
            continueResponse: true
          })
        : null

      this.captureBuffer = ''
      this.lastNoBoundarySpokenText = ''
      this.noBoundaryStablePasses = 0

      if (this.idleTimer) {
        this.clearScheduled(this.idleTimer)
        this.idleTimer = null
      }

      if (finalized) {
        return
      }

      return
    }

    this.captureBuffer += plainChunk
    this.lastNoBoundarySpokenText = ''
    this.noBoundaryStablePasses = 0

    this.trimCaptureBuffer()

    if (this.idleTimer) {
      this.clearScheduled(this.idleTimer)
    }

    this.idleTimer = this.schedule(() => {
      this.maybeFinalize()
    }, this.idleMs)
  }

  maybeFinalize(options = {}) {
    const forcedBoundary = options.forcedBoundary || ''
    const continueResponse = Boolean(options.continueResponse)
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
      spokenText,
      forcedBoundary
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
      if (spokenText && spokenText === this.lastNoBoundarySpokenText) {
        this.noBoundaryStablePasses += 1
      } else {
        this.lastNoBoundarySpokenText = spokenText
        this.noBoundaryStablePasses = spokenText ? 1 : 0
      }

      const stableNoBoundary = Boolean(spokenText) && this.noBoundaryStablePasses >= 2

      if (stableNoBoundary) {
        boundary.complete = true
        boundary.stableNoBoundary = true
      }

      if (!boundary.complete) {
        this.logDebug('speech.analysis_rejected', {
          reason: 'no-boundary',
          spokenText: summarizeForLog(spokenText),
          boundary
        })
        return null
      }
    }

    this.pendingResponse = continueResponse
    this.captureBuffer = ''
    this.sawAltScreenExit = false
    this.lastNoBoundarySpokenText = ''
    this.noBoundaryStablePasses = 0

    if (!continueResponse && this.isShellPrompt(lastLine)) {
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
    this.onFinalizedText(spokenText, {
      continueResponse,
      forcedBoundary,
      boundary,
      activeAssistant: this.activeAssistant || ''
    })

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

  getCompletionBoundaryState({ lines, rawLines, lastLine, spokenText, forcedBoundary = '' }) {
    if (!spokenText) {
      return {
        complete: false,
        shellPrompt: false,
        claudePromptReturn: false,
        assistantPrompt: false,
        codexTrailingSpeech: false,
        altScreenExit: Boolean(this.sawAltScreenExit),
        transitionBoundary: forcedBoundary
      }
    }

    const shellPrompt = this.isShellPrompt(lastLine)
    const claudePromptReturn =
      this.activeAssistant === 'claude' && this.hasClaudePromptReturn(rawLines || lines)
    const assistantPrompt = this.isAssistantPrompt(lastLine)
    const codexTrailingSpeech = this.hasCodexTrailingSpeechAfterPrompt(rawLines || lines)
    const altScreenExit = Boolean(this.sawAltScreenExit)
    const transitionBoundary = forcedBoundary

    return {
      complete:
        Boolean(transitionBoundary) ||
        shellPrompt ||
        claudePromptReturn ||
        assistantPrompt ||
        codexTrailingSpeech ||
        altScreenExit,
      shellPrompt,
      claudePromptReturn,
      assistantPrompt,
      codexTrailingSpeech,
      altScreenExit,
      transitionBoundary
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

  trimCaptureBuffer() {
    if (this.captureBuffer.length <= this.maxCaptureChars) {
      return
    }

    const preserveHead = Math.max(2000, Math.floor(this.maxCaptureChars * 0.35))
    const preserveTail = Math.max(2000, this.maxCaptureChars - preserveHead)
    const head = this.captureBuffer.slice(0, preserveHead)
    const tail = this.captureBuffer.slice(-preserveTail)

    this.captureBuffer = `${head}\n${tail}`
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

function stripAnsiInputSequences(text) {
  return String(text || '')
    .replace(/\u001b\[[0-9;?]*[@-~]/g, '')
    .replace(/\u001bO./g, '')
}

function detectSpeechTransitionBoundary(text) {
  const lines = String(text || '').split('\n')
  const leadingLines = []

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const embedded = splitLineAtSpeechTransition(line)

    if (embedded) {
      if (embedded.leadingText.trim()) {
        leadingLines.push(embedded.leadingText)
      }

      return {
        kind: embedded.kind,
        leadingText: leadingLines.join('\n').trim()
      }
    }

    const kind = getSpeechTransitionKind(line)
    if (kind) {
      return {
        kind,
        leadingText: leadingLines.join('\n').trim()
      }
    }

    leadingLines.push(line)
  }

  return null
}

function splitLineAtSpeechTransition(line) {
  const text = String(line || '')

  for (const pattern of EMBEDDED_SPEECH_TRANSITION_PATTERNS) {
    const match = pattern.regex.exec(text)
    if (!match || match.index <= 0) {
      continue
    }

    return {
      kind: pattern.kind,
      leadingText: text.slice(0, match.index).trimEnd()
    }
  }

  return null
}

function getSpeechTransitionKind(line) {
  const trimmed = String(line || '').trim()

  if (!trimmed) {
    return ''
  }

  if (
    /^(?:would you like to run the following command\?|press enter to confirm\b|esc to cancel\b)/i.test(
      trimmed
    ) ||
    /^[✔✓]\s+you approved\b/i.test(trimmed) ||
    /^(?:(?:›|>|❯)\s*)?\d+\s+tab to queue message\b/i.test(trimmed) ||
    /^\d+\.\s+(?:yes|no)\b/i.test(trimmed)
  ) {
    return 'approval'
  }

  if (
    isToolProgressLine(trimmed) ||
    /^ran\b/i.test(trimmed)
  ) {
    return 'tool'
  }

  if (
    /^[$#]\s+\S/.test(trimmed) ||
    /^(?:diff --git|index [0-9a-f]+|@@ |\+\+\+ |--- )/.test(trimmed) ||
    /^[+-]\s*(?:const|let|var|function|if|for|while|return|class|import|export|def|from|async|await|try|catch|finally|elif|else|pass|with|print)\b/.test(
      trimmed
    ) ||
    /^(?:ls|rm|mv|cp|cat|git|node|npm|python|python3)\s*:/i.test(trimmed) ||
    /^[\w./-]+:\s+(?:cannot|no such file|permission denied|not found)\b/i.test(trimmed)
  ) {
    return 'output'
  }

  return ''
}

const EMBEDDED_SPEECH_TRANSITION_PATTERNS = [
  {
    kind: 'tool',
    regex:
      /\s+[•◦●]\s+(?=(?:Explor(?:e|ed|ing)\b|Working\b|Ran\b|Bash\b|Read(?:ing)?\b|Search(?:ed(?:\s+for)?|ing)?\b|Open(?:ed|ing)?\b|Inspect(?:ed|ing)?\b|Review(?:ed|ing)?\b|Analyz(?:e|ed|ing)\b|Patch(?:ed|ing)\b|Apply(?:ing)?\s+patch\b|ApplyPatch\b|Update(?:d)?\s+Plan\b|Running\b|Waited for background terminal\b|Tool loaded\b))/i
  },
  {
    kind: 'approval',
    regex: /\s+(?=Would you like to run the following command\?)/i
  },
  {
    kind: 'approval',
    regex: /\s+(?=(?:press|hit)\s+enter\b.*\b(?:confirm|approve)\b)/i
  },
  {
    kind: 'approval',
    regex: /\s+(?=esc to cancel\b)/i
  },
  {
    kind: 'approval',
    regex: /\s+(?=(?:(?:›|>|❯)\s*)?\d+\s+tab to queue message\b)/i
  },
  {
    kind: 'output',
    regex: /\s+(?=(?:diff --git|index [0-9a-f]+|@@ |\+\+\+ |--- |\$ ))/i
  }
]

module.exports = {
  CodexSpeechInterceptor
}
