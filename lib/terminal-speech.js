const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]|(?:].*?(?:\u0007|\u001B\\)))/g

function normalizeTerminalText(text, { trimEdges = true } = {}) {
  const preprocessed = String(text || '')
    .replace(/\x07/g, '')
    .replace(/\u001b\[[\d;]*H/g, '\n')
    .replace(/\u001b\[(\d*)C/g, (_, n) => ' '.repeat(Math.max(1, parseInt(n || '1', 10))))
  const withoutAnsi = preprocessed.replace(ANSI_PATTERN, '')
  let withoutBackspaces = ''

  for (const char of withoutAnsi) {
    if (char === '\b' || char === '\u007f') {
      withoutBackspaces = withoutBackspaces.slice(0, -1)
      continue
    }

    withoutBackspaces += char
  }

  const normalized = withoutBackspaces
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')

  return trimEdges ? normalized.trim() : normalized
}

function stripCodeBlocks(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n')
}

function extractSpeechText(text) {
  const paragraphs = buildSpeechParagraphEntries(text)
  const lastSpeechIndex = findLastSpeechParagraphIndex(paragraphs)

  if (lastSpeechIndex === -1) {
    return ''
  }

  const speechBlock = collectTerminalSpeechBlock(paragraphs, lastSpeechIndex)

  return speechBlock
    .filter((candidate) => candidate.score >= 4)
    .map((candidate) => candidate.paragraph)
    .join(' ')
    .trim()
}

function buildSpeechParagraphEntries(text) {
  return stripCodeBlocks(text)
    .replace(/\n(?:[ \t]+\n)+/g, '\n\n')
    .split(/\n{2,}/)
    .map((paragraph, index) => {
      const trimmedParagraph = String(paragraph || '').trim()
      const isPromptParagraph = isUserPromptParagraph(trimmedParagraph)
      const codeLikeParagraph = isCodeLikeParagraph(trimmedParagraph)

      if (isPromptParagraph || codeLikeParagraph) {
        return {
          index,
          paragraph: '',
          score: 0,
          isPromptParagraph,
          isMetaParagraph: codeLikeParagraph,
          isSkippableGap: true
        }
      }

      const rawLines = trimmedParagraph
        .split('\n')
        .map((line) => String(line || '').trim())
        .filter(Boolean)
      const cleanedLines = trimmedParagraph
        .split('\n')
        .map((line) => sanitizeSpeechLine(line))
        .filter(Boolean)
      const cleanedParagraph = cleanedLines.join(' ').replace(/\s{2,}/g, ' ').trim()
      const skippableGap =
        cleanedParagraph.length === 0 &&
        rawLines.length > 0 &&
        rawLines.every((line) => {
          const normalizedLine = stripAssistantChromePrefix(stripMergedFooterChrome(line))
          return isPromptOrFooterLine(normalizedLine) || isCodeLikeLine(normalizedLine)
        })

      return {
        index,
        paragraph: cleanedParagraph,
        score: scoreSpeechParagraph(cleanedParagraph),
        isPromptParagraph: false,
        isMetaParagraph: isMetaParagraph(trimmedParagraph),
        isSkippableGap: skippableGap
      }
    })
}

function isCodeLikeParagraph(paragraph) {
  const lines = String(paragraph || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)

  if (!lines.length) {
    return false
  }

  if (lines.some((line) => /^```/.test(line))) {
    return true
  }

  if (lines.length < 2) {
    return false
  }

  let codeLikeLines = 0

  for (const line of lines) {
    if (
      /^(?:diff --git|index [0-9a-f]+|@@ |\+\+\+ |--- )/.test(line) ||
      /^[+-]\s*(?:const|let|var|function|if|for|while|return|class|import|export)\b/.test(line) ||
      /^(?:const|let|var|function|if|for|while|return|class|import|export)\b/.test(line) ||
      /^(?:\$|#)\s+\S+/.test(line) ||
      /^(?:echo|cd|ls|cat|grep|rg|find|node|npm|pnpm|yarn|python|python3|pip|git|docker|kubectl|curl|wget|sed|awk|chmod|chown|mv|cp|rm|touch|mkdir|export|set)\b/.test(
        line
      ) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(line) ||
      /^\w+\s*\([^)]*\)\s*\{?$/.test(line) ||
      /=>/.test(line) ||
      /[{}[\]]/.test(line) ||
      /\$[{(]?[A-Za-z_][A-Za-z0-9_}]*/.test(line)
    ) {
      codeLikeLines += 1
    }
  }

  return codeLikeLines / lines.length >= 0.6
}

function findLastSpeechParagraphIndex(paragraphs) {
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    if (paragraphs[index].score >= 4) {
      return index
    }
  }

  return -1
}

function collectTerminalSpeechBlock(paragraphs, lastSpeechIndex) {
  let startIndex = lastSpeechIndex

  while (startIndex > 0) {
    const previous = paragraphs[startIndex - 1]

    if (previous.score >= 4) {
      startIndex -= 1
      continue
    }

    if (!previous.isPromptParagraph && !previous.isMetaParagraph && !previous.isSkippableGap) {
      if (isHeadingParagraph(previous.paragraph) && startIndex >= 2) {
        const beforeHeading = paragraphs[startIndex - 2]

        if (beforeHeading.score >= 4) {
          startIndex -= 2
          continue
        }
      }

      break
    }

    let separatorStart = startIndex - 1

    while (
      separatorStart >= 0 &&
      (
        paragraphs[separatorStart].isPromptParagraph ||
        paragraphs[separatorStart].isMetaParagraph ||
        paragraphs[separatorStart].isSkippableGap
      )
    ) {
      separatorStart -= 1
    }

    if (separatorStart >= 0 && paragraphs[separatorStart].score >= 4) {
      startIndex = separatorStart
      continue
    }

    break
  }

  return paragraphs.slice(startIndex, lastSpeechIndex + 1)
}

function sanitizeSpeechLine(line) {
  const trimmed = stripAssistantChromePrefix(stripMergedFooterChrome(String(line || '').trim()))

  if (!trimmed || shouldIgnoreSpeechLine(trimmed) || isCodeLikeLine(trimmed)) {
    return ''
  }

  return trimmed
    .replace(/^(?:[-*]|[•◦●])\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\[[^\]]+\]\((?:\/|https?:\/\/)[^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isCodeLikeLine(line) {
  const trimmed = String(line || '').trim()

  if (!trimmed) {
    return false
  }

  return (
    /^(?:diff --git|index [0-9a-f]+|@@ |\+\+\+ |--- )/.test(trimmed) ||
    /^[+-]\s*(?:const|let|var|function|if|for|while|return|class|import|export|def|from|async|await|try|catch|finally|elif|else|pass|with)\b/.test(
      trimmed
    ) ||
    /^(?:const|let|var|function|if|for|while|return|class|import|export|def|from|async|await|try|catch|finally|elif|else|pass|with)\b/.test(
      trimmed
    ) ||
    /^(?:\$|#)\s+\S+/.test(trimmed) ||
    /^(?:echo|cd|ls|cat|grep|rg|find|node|npm|pnpm|yarn|python|python3|pip|git|docker|kubectl|curl|wget|sed|awk|chmod|chown|mv|cp|rm|touch|mkdir|export|set)\b/.test(
      trimmed
    ) ||
    /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^=]/.test(trimmed) ||
    /^\w+\s*\([^)]*\)\s*\{?$/.test(trimmed) ||
    /^\w+\(\)\s*$/.test(trimmed) ||
    /^if __name__ == ["']__main__["']:?$/.test(trimmed) ||
    /=>/.test(trimmed) ||
    /[{}[\]]/.test(trimmed) ||
    /\$[{(]?[A-Za-z_][A-Za-z0-9_}]*/.test(trimmed)
  )
}

function stripAssistantChromePrefix(line) {
  const trimmed = String(line || '').trim()

  if (!trimmed) {
    return ''
  }

  let cleaned = trimmed

  if (/\/model\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/^.*\/model\b\s*/i, '')
  }

  if (/\bchanneling/i.test(cleaned)) {
    cleaned = cleaned.replace(/^.*?\b(?=(?:Hey|Hi|Hello|Yes|No|Sure|Okay|Alright|I\b|We\b|That\b|This\b))/i, '')
  }

  cleaned = cleaned.replace(/^(?:[a-z]{1,3}\s+){1,4}(?=[A-Z])/, '')
  cleaned = cleaned.replace(/^[·•▪◦✻✶✢✦✧✽…;:,\-–—\s]+/, '')

  return cleaned.trim()
}

function isUserPromptParagraph(paragraph) {
  const lines = String(paragraph || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)

  if (!lines.length) {
    return false
  }

  return /^(?:>|>>|›|»|❯|You:|User:|Human:|Prompt:)/i.test(lines[0])
}

function isMetaParagraph(paragraph) {
  const lines = String(paragraph || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)

  if (!lines.length) {
    return false
  }

  return lines.every((line) => isPromptOrFooterLine(line))
}

function isHeadingParagraph(paragraph) {
  const trimmed = String(paragraph || '').trim()
  const wordCount = (trimmed.match(/[A-Za-z]{2,}/g) || []).length

  if (!trimmed || wordCount < 1 || wordCount > 5) {
    return false
  }

  if (!/:$/.test(trimmed)) {
    return false
  }

  return !/[{}[\]<>`\\/]/.test(trimmed)
}

function isPromptOrFooterLine(line) {
  const trimmed = String(line || '').trim()

  if (!trimmed) {
    return true
  }

  return (
    /^(?:(?:>|>>|›|»|❯)(?:\s*.*)?|(?:You:|User:|Human:|Prompt:)\s*)$/.test(trimmed) ||
    /^[^@\s]+@[^:\s]+:[^#$\n]+[$#]\s*$/.test(trimmed) ||
    /^PS [^>]+>\s*$/.test(trimmed) ||
    /^[A-Za-z]:\\.*>\s*$/.test(trimmed) ||
    /^\?\s+for shortcuts\b/i.test(trimmed) ||
    /^[─━-]{10,}(?:\s+[▪•]+(?:\s+[─━-]+)?)?$/.test(trimmed) ||
    /^!\s*pending steer:/i.test(trimmed) ||
    /\bcontext left\b/i.test(trimmed) ||
    (/\b\d+%\s+left\b/i.test(trimmed) && /[\\/]/.test(trimmed)) ||
    /^(?:model|engine|provider|directory)\s*:/i.test(trimmed) ||
    /\/(?:ps|clean|model)\b/i.test(trimmed) ||
    /^(?:press|hit)\s+(?:enter|esc|tab)\b/i.test(trimmed) ||
    /^esc to cancel\b/i.test(trimmed) ||
    /^\b(?:OpenAI\s+)?codex\b/i.test(trimmed) ||
    /^\bClaude Code\b/i.test(trimmed)
  )
}

function stripMergedFooterChrome(line) {
  const trimmed = String(line || '').trim()

  if (!/\b(?:context left|\d+%\s+left)\b/i.test(trimmed)) {
    return trimmed
  }

  const lastPathSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))

  if (lastPathSeparator === -1) {
    return trimmed
  }

  const tail = trimmed.slice(lastPathSeparator + 1)
  const joinIndex = /^[^\s]*[a-z][A-Z]/.test(tail) ? tail.search(/[a-z][A-Z]/) : -1

  if (joinIndex === -1) {
    const spacedSentenceIndex = tail.search(/\s+(?=[A-Z].*[.!?]["']?$)/)

    if (spacedSentenceIndex === -1) {
      return trimmed
    }

    return tail.slice(spacedSentenceIndex).trim()
  }

  return tail.slice(joinIndex + 1).trim()
}

function shouldIgnoreSpeechLine(line) {
  if (!line) {
    return true
  }

  if (/^(?:(?:>|>>|›|»|❯)(?:\s*.*)?|(?:You:|User:|Human:|Prompt:)\s*)$/.test(line)) {
    return true
  }

  if (
    /^[^@\s]+@[^:\s]+:[^#$\n]+[$#]\s*$/.test(line) ||
    /^PS [^>]+>\s*$/.test(line) ||
    /^[A-Za-z]:\\.*>\s*$/.test(line)
  ) {
    return true
  }

  if (/^(?:Chunk ID:|Wall time:|Process exited|Output:|Success\. Updated|fatal:)/i.test(line)) {
    return true
  }

  if (/^[•◦]\s*(?:Exploring|Explored|Working|Ran|Updated Plan|Waited for background terminal)\b/i.test(line)) {
    return true
  }

  if (/^(?:Working|Running)\s*\([^)]*(?:esc to interrupt|ctrl\+c)[^)]*\)$/i.test(line)) {
    return true
  }

  if (/\bbackground terminal running\b/i.test(line) && /\/ps to view\b/i.test(line)) {
    return true
  }

  if (
    /^●\s*(?:Bash\b|Tool loaded\b|Read\s+\d+\s+files?\b|Searched for\b|Running\b|Updated Plan\b)/i.test(
      line
    )
  ) {
    return true
  }

  if (/\(ctrl\+o to expand\)/i.test(line)) {
    return true
  }

  if (/^[└├│╰─⎿]+\s*/.test(line)) {
    return true
  }

  if (/\btips?\s*:/i.test(line)) {
    return true
  }

  if (/^\?\s+for shortcuts\b/i.test(line)) {
    return true
  }

  if (/^[─━-]{10,}(?:\s+[▪•]+(?:\s+[─━-]+)?)?$/.test(line)) {
    return true
  }

  if (/^!\s*pending steer:/i.test(line)) {
    return true
  }

  if (/\bcontext left\b/i.test(line)) {
    return true
  }

  if (/\b\d+%\s+left\b/i.test(line) && /[\\/]/.test(line)) {
    return true
  }

  if (
    /^(?:model|engine|provider)\s*:/i.test(line) ||
    /^(?:gpt|o\d|claude|gemini|codex)[\w .:-]*\d+%?\s*(?:context left)?$/i.test(line)
  ) {
    return true
  }

  if (/^(?:press|hit)\s+(?:enter|esc|tab)\b/i.test(line)) {
    return true
  }

  if (/^esc\s+to\s+(?:cancel|interrupt)\b/i.test(line)) {
    return true
  }

  if (/\besc to\s+int(?:e\s*)?r(?:r\s*)?upt\b/i.test(line)) {
    return true
  }

  if (/^(?:diff --git|index [0-9a-f]+|@@ |\+\+\+ |--- )/.test(line)) {
    return true
  }

  if (/^\d+\s+[+-]/.test(line)) {
    return true
  }

  if (/\(\+\d+\s+-\d+\)$/.test(line)) {
    return true
  }

  if (/^~\/\S+/.test(line) && !/[.!?]$/.test(line)) {
    return true
  }

  if (/^[✻✶✢✦✧✽]\s+\S/.test(line)) {
    return true
  }

  if (/\bchanneling\b/i.test(line) && /\/model\b/i.test(line) && !/[.!?]$/.test(line)) {
    return true
  }

  if (/\b\d+\s+tokens\b/i.test(line) && /[·↓↑]/.test(line)) {
    return true
  }

  if (/^current\s+dir\s*:/i.test(line)) {
    return true
  }

  if (/^git\s+repo\b/i.test(line)) {
    return true
  }

  if (/^(?:M|A|D|R|C|\?\?)\s+\S+/.test(line)) {
    return true
  }

  if (/^(?:[rwx-]{9}|[dlcbps-][rwx-]{9})\s+\d+\s+\S+\s+\S+\s+\d+/.test(line)) {
    return true
  }

  if (/^[A-Za-z0-9._-]+$/.test(line) && !/[.!?]$/.test(line)) {
    return true
  }

  if (/^(?:\/|[A-Za-z]:\\).+/.test(line) && /[\\/]/.test(line) && !/[.!?]$/.test(line)) {
    return true
  }

  if (/^\[[^\]]+\]\((?:\/|https?:\/\/)[^)]+\)$/.test(line)) {
    return true
  }

  const alphaCount = (line.match(/[A-Za-z]/g) || []).length
  const symbolCount = (line.match(/[^A-Za-z0-9\s.,!?'"-]/g) || []).length

  return alphaCount < 4 || (symbolCount > alphaCount && !/[.!?]$/.test(line))
}

function scoreSpeechParagraph(paragraph) {
  const wordCount = (String(paragraph || '').match(/[A-Za-z]{2,}/g) || []).length

  if (wordCount < 4) {
    return isShortSpeechParagraph(paragraph) ? 4 : 0
  }

  let score = wordCount

  if (/[.!?]/.test(paragraph)) {
    score += 3
  }

  if (/\b(?:I|we|you|it|this|that|there|here)\b/i.test(paragraph)) {
    score += 2
  }

  if (/[{}[\]<>]/.test(paragraph)) {
    score -= 2
  }

  return score
}

function isShortSpeechParagraph(paragraph) {
  const trimmed = String(paragraph || '').trim()
  const wordCount = (trimmed.match(/[A-Za-z]{2,}/g) || []).length

  if (!trimmed || wordCount < 1 || wordCount > 3) {
    return false
  }

  if (!/[.!?]["']?$/.test(trimmed)) {
    return false
  }

  if (/[{}[\]<>`/@\\|]/.test(trimmed)) {
    return false
  }

  return !/^(?:tip|tips?|model|directory|provider|engine)\s*:/i.test(trimmed)
}

function getLastNonEmptyLine(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (String(lines[index] || '').trim()) {
      return lines[index]
    }
  }

  return ''
}

module.exports = {
  extractSpeechText,
  getLastNonEmptyLine,
  normalizeTerminalText,
  scoreSpeechParagraph,
  shouldIgnoreSpeechLine,
  stripCodeBlocks
}
