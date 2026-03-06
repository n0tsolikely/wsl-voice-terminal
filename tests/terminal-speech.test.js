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

test('extractSpeechText ignores Codex prompt chrome like tips and context meters', () => {
  const input = [
    'I fixed the audio path and lowered the idle delay so replies speak faster.',
    '',
    'Tip: Press # to search files.',
    'gpt-5-codex high 86% context left',
    '> '
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(output, 'I fixed the audio path and lowered the idle delay so replies speak faster.')
})

test('extractSpeechText ignores Codex progress chrome and command tree lines', () => {
  const input = [
    '• Ran npm test',
    '└ node --test',
    '',
    'I fixed the clipboard shortcuts and compacted the voice drawer.',
    '',
    '› Write tests for @filename'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(output, 'I fixed the clipboard shortcuts and compacted the voice drawer.')
})

test('extractSpeechText strips decorative bullet markers from real reply text', () => {
  const input = [
    '• Here and ready. If you want, I can inspect code, fix something, review a change, or just answer a question.',
    '',
    '› Write tests for @filename'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    'Here and ready. If you want, I can inspect code, fix something, review a change, or just answer a question.'
  )
})

test('extractSpeechText ignores pending-steer and Codex footer lines', () => {
  const input = [
    '! pending steer: Ask for more tests.',
    '',
    'I fixed the clipboard bridge and the reply playback trigger.',
    '',
    'gpt-5.4 xhigh · 93% left · /mnt/c/Users/peter',
    '›Write tests for @filename'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(output, 'I fixed the clipboard bridge and the reply playback trigger.')
})

test('extractSpeechText keeps Claude reply text but drops Claude tool chatter and shortcuts chrome', () => {
  const input = [
    '● Read 1 file (ctrl+o to expand)',
    '',
    '❯ hello',
    '',
    "● Hey! I've read the rehydration file and have the full context from the previous session.",
    '',
    '──────────────────────────────────────────────────── ▪▪▪ ─',
    '❯ ',
    '? for shortcuts'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    "Hey! I've read the rehydration file and have the full context from the previous session."
  )
})
