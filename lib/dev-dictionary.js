(function bootstrapDevDictionary(root) {
  const DIRECT_RULES = [
    ['open square bracket', '['],
    ['close square bracket', ']'],
    ['open curly brace', '{'],
    ['close curly brace', '}'],
    ['open bracket', '('],
    ['close bracket', ')'],
    ['single quote', "'"],
    ['slash slash', '//'],
    ['colon colon', '::'],
    ['snake case', 'snake_case'],
    ['camel case', 'camelCase'],
    ['pascal case', 'PascalCase'],
    ['cloud code', 'Claude Code'],
    ['clawed code', 'Claude Code'],
    ['get hub', 'GitHub'],
    ['get lab', 'GitLab'],
    ['code x', 'codex'],
    ['co decks', 'codex'],
    ['backslash', '\\'],
    ['quote', '"']
  ].sort((left, right) => right[0].length - left[0].length)

  const IDENTIFIER_CONTEXT_PATTERN = [
    'variable',
    'var',
    'constant',
    'const',
    'property',
    'field',
    'key',
    'name',
    'identifier',
    'parameter',
    'param',
    'argument',
    'arg',
    'function',
    'method',
    'class',
    'type'
  ].join('|')

  const IDENTIFIER_BOUNDARY_PATTERN = [
    'and',
    'then',
    'with',
    'using',
    'plus',
    'minus',
    'equals',
    'equal',
    'open',
    'close',
    'slash',
    'backslash',
    'quote',
    'single',
    'double'
  ].join('|')

  const CASE_RULES = [
    {
      marker: 'snake_case',
      formatIdentifier: toSnakeCase
    },
    {
      marker: 'camelCase',
      formatIdentifier: toCamelCase
    },
    {
      marker: 'PascalCase',
      formatIdentifier: toPascalCase
    }
  ]

  function applyDevDictionary(text) {
    let nextText = normalizeWhitespace(text)

    if (!nextText) {
      return ''
    }

    nextText = applyDirectRules(nextText)
    nextText = applyScopedIdentifierRules(nextText)
    nextText = compactPairedTokens(nextText)

    return normalizeWhitespace(nextText)
  }

  function applyDirectRules(text) {
    let nextText = text

    for (const [spokenPhrase, replacement] of DIRECT_RULES) {
      nextText = nextText.replace(buildPhraseRegex(spokenPhrase), replacement)
    }

    return nextText
  }

  function applyScopedIdentifierRules(text) {
    let nextText = text

    for (const rule of CASE_RULES) {
      const scopedPattern = new RegExp(
        `\\b${escapeRegExp(rule.marker)}\\s+(${IDENTIFIER_CONTEXT_PATTERN})\\s+([a-z0-9][a-z0-9\\s-]*?)(?=(?:\\s+(?:${IDENTIFIER_BOUNDARY_PATTERN})\\b)|$)`,
        'gi'
      )

      nextText = nextText.replace(scopedPattern, (_match, context, identifier) => {
        return `${rule.marker} ${context} ${rule.formatIdentifier(identifier)}`
      })
    }

    return nextText
  }

  function compactPairedTokens(text) {
    return text
      .replace(/\(\s*\)/g, '()')
      .replace(/\[\s*\]/g, '[]')
      .replace(/\{\s*\}/g, '{}')
  }

  function toSnakeCase(text) {
    const words = toWords(text)

    return words.join('_')
  }

  function toCamelCase(text) {
    const words = toWords(text)

    if (!words.length) {
      return ''
    }

    return words
      .map((word, index) => (index === 0 ? word : capitalize(word)))
      .join('')
  }

  function toPascalCase(text) {
    return toWords(text)
      .map(capitalize)
      .join('')
  }

  function toWords(text) {
    return normalizeWhitespace(text)
      .split(/[\s_-]+/)
      .map((word) => word.toLowerCase())
      .filter(Boolean)
  }

  function capitalize(text) {
    if (!text) {
      return ''
    }

    return `${text[0].toUpperCase()}${text.slice(1)}`
  }

  function normalizeWhitespace(text) {
    return String(text || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  function buildPhraseRegex(phrase) {
    return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi')
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  const api = {
    applyDevDictionary,
    DEV_DICTIONARY_RULES: DIRECT_RULES.slice()
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalDevDictionary = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
