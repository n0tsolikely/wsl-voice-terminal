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

test('extractSpeechText keeps short conversational replies when they are the actual assistant output', () => {
  const input = ['• Hello.', '', '› Use /skills to list available skills'].join('\n')

  const output = extractSpeechText(input)

  assert.equal(output, 'Hello.')
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

test('extractSpeechText recovers reply text when a Codex footer redraw is glued to the next sentence', () => {
  const input = [
    'gpt-5.4 xhigh · 100% left · /mnt/c/Users/peterHere is the real assistant reply.',
    'It should still be spoken cleanly.',
    '› Write tests for @filename'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    'Here is the real assistant reply. It should still be spoken cleanly.'
  )
})

test('extractSpeechText recovers reply text when a Codex footer redraw is glued to the next sentence with spaces', () => {
  const input = [
    'Yes. Your last message came through clearly.',
    '',
    'gpt-5.4 xhigh · 100% left · /mnt/c/Users/peter  Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand.',
    '› Use /skills to list available skills'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    'Yes. Your last message came through clearly. Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand.'
  )
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

test('extractSpeechText prefers the final conversational run over earlier assistant chatter', () => {
  const input = [
    "I'm checking that now and reading the current files.",
    '',
    '● Bash(cd /repo && git status)',
    '',
    'Here is the final assistant answer.',
    '',
    'It should be the part that gets spoken.',
    '',
    '❯ '
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    'Here is the final assistant answer. It should be the part that gets spoken.'
  )
})

test('extractSpeechText keeps full multi-paragraph replies instead of truncating after one paragraph', () => {
  const input = [
    'Yes. Your last message came through clearly.',
    '',
    'Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand.',
    '',
    'The spacing is fixed now and future replies should read cleanly.',
    '',
    '› Use /skills to list available skills'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    'Yes. Your last message came through clearly. Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand. The spacing is fixed now and future replies should read cleanly.'
  )
})

test('extractSpeechText ignores earlier longer assistant chatter when a final answer appears later', () => {
  const input = [
    'I am checking the files and tracing the runtime behavior now.',
    '',
    'I am also reviewing the renderer and the speech relay before I finalize anything.',
    '',
    '● Bash(cd /repo && node --test)',
    '',
    'The actual answer is ready now.',
    '',
    'Only this final reply should be spoken.',
    '',
    '❯ '
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    'The actual answer is ready now. Only this final reply should be spoken.'
  )
})

test('extractSpeechText keeps intro text when a short heading introduces a later list', () => {
  const input = [
    "I'm checking the current workspace state so I can answer concretely instead of guessing.",
    '',
    'Right now, not much. We are sitting in the Windows home directory, not an active repo root.',
    '',
    'What I verified:',
    '',
    'Current dir: /mnt/c/Users/peter',
    'Git repo found nearby: /mnt/c/Users/peter/film_crew',
    'Synapse is not engaged here.',
    '',
    'So the concrete answer is: no repo-specific workflow is active yet.'
  ].join('\n')

  const output = extractSpeechText(input)

  assert.equal(
    output,
    "I'm checking the current workspace state so I can answer concretely instead of guessing. Right now, not much. We are sitting in the Windows home directory, not an active repo root. Current dir: /mnt/c/Users/peter Git repo found nearby: /mnt/c/Users/peter/film_crew Synapse is not engaged here. So the concrete answer is: no repo-specific workflow is active yet."
  )
})
