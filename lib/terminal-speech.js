const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]|(?:].*?(?:\u0007|\u001B\\)))/g

function normalizeTerminalText(text, { trimEdges = true } = {}) {
  const withoutAnsi = String(text || '').replace(ANSI_PATTERN, '')
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
  const paragraphs = stripCodeBlocks(text)
    .split(/\n{2,}/)
    .map((paragraph) => {
      const cleanedLines = paragraph
        .split('\n')
        .map((line) => sanitizeSpeechLine(line))
        .filter(Boolean)

      return cleanedLines.join(' ').replace(/\s{2,}/g, ' ').trim()
    })
    .filter(Boolean)
  const candidates = paragraphs.filter((paragraph) => scoreSpeechParagraph(paragraph) >= 4)

  if (!candidates.length) {
    return ''
  }

  const rankedCandidates = candidates
    .map((paragraph, index) => ({
      index,
      paragraph,
      score: scoreSpeechParagraph(paragraph)
    }))
    .sort((left, right) => right.score - left.score || right.index - left.index)
  const bestCandidate = rankedCandidates[0]
  const bestGroup = [bestCandidate]
  const previousCandidate = rankedCandidates.find(
    (candidate) => candidate.index === bestCandidate.index - 1
  )
  const nextCandidate = rankedCandidates.find(
    (candidate) => candidate.index === bestCandidate.index + 1
  )

  if (previousCandidate && previousCandidate.score >= 4) {
    bestGroup.unshift(previousCandidate)
  }

  if (nextCandidate && nextCandidate.score >= 4) {
    bestGroup.push(nextCandidate)
  }

  return bestGroup
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.paragraph)
    .join(' ')
    .trim()
}

function sanitizeSpeechLine(line) {
  const trimmed = String(line || '').trim()

  if (!trimmed || shouldIgnoreSpeechLine(trimmed)) {
    return ''
  }

  return trimmed
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\[[^\]]+\]\((?:\/|https?:\/\/)[^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
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

  if (/^[└├│╰─]+\s*/.test(line)) {
    return true
  }

  if (/^(?:tip|tips?)\s*:/i.test(line)) {
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

  if (/^(?:diff --git|index [0-9a-f]+|@@ |\+\+\+ |--- )/.test(line)) {
    return true
  }

  if (/^(?:M|A|D|R|C|\?\?)\s+\S+/.test(line)) {
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
    return 0
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
