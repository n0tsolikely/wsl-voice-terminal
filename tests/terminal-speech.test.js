const test = require('node:test')
const assert = require('node:assert/strict')

const {
  extractSpeechText,
  normalizeTerminalText,
  stripCodeBlocks
} = require('../lib/terminal-speech')

test('normalizeTerminalText strips ANSI escapes and backspaces', () => {
  const input = '\u001b[31mhelxo\u001b[0m\b\blo\r\nprompt> '
  const output = normalizeTerminalText(input)

  assert.equal(output, 'hello\nprompt>')
})

test('stripCodeBlocks removes fenced code content', () => {
  const input = 'Before\n```js\nconsole.log("x")\n```\nAfter'
  const output = stripCodeBlocks(input)

  assert.equal(output, 'Before\n\nAfter')
})

test('extractSpeechText keeps conversational text and drops code blocks and prompts', () => {
  const input = [
    'You:',
    'Give me a fix.',
    '',
    'Here is the change you need.',
    '',
    '```js',
    'console.log("hidden")',
    '```',
    '',
    'It will keep the command line behavior intact.',
    'user@host:~/repo$'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(output, 'Here is the change you need. It will keep the command line behavior intact.')
})

test('extractSpeechText returns empty for command-heavy output', () => {
  const input = [
    'diff --git a/file b/file',
    'index 123..456 100644',
    '--- a/file',
    '+++ b/file',
    '@@ -1,1 +1,1 @@',
    '+const x = 1'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(output, '')
})
