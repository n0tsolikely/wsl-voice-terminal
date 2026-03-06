const test = require('node:test')
const assert = require('node:assert/strict')

const {
  appendCommittedDictation,
  clearInterimDictation,
  commitInterimDictation,
  consumeTerminalInput,
  createDictationBuffer,
  replaceInterimDictation
} = require('../lib/dictation-buffer')

test('interim dictation replaces visible text and clears cleanly', () => {
  let buffer = createDictationBuffer()

  let replaced = replaceInterimDictation(buffer, 'hello there')

  assert.equal(replaced.insertText, 'hello there')
  assert.equal(replaced.eraseText, '')

  buffer = replaced.buffer
  replaced = replaceInterimDictation(buffer, 'hello there friend')

  assert.equal(replaced.eraseText, '\u007f'.repeat('hello there'.length))
  assert.equal(replaced.insertText, 'hello there friend')

  buffer = replaced.buffer

  const cleared = clearInterimDictation(buffer)

  assert.equal(cleared.eraseText, '\u007f'.repeat('hello there friend'.length))
  assert.equal(cleared.buffer.interimValue, '')
})

test('committing interim text promotes it into committed text without extra output', () => {
  let buffer = createDictationBuffer()

  let replaced = replaceInterimDictation(buffer, 'draft sentence')
  buffer = replaced.buffer

  const committed = commitInterimDictation(buffer)

  assert.equal(committed.committedText, 'draft sentence')
  assert.equal(committed.buffer.committedText, 'draft sentence')
  assert.equal(committed.buffer.interimValue, '')
})

test('committed dictation adds leading space only when needed', () => {
  let buffer = createDictationBuffer()

  let appended = appendCommittedDictation(buffer, 'hello')
  assert.equal(appended.insertText, 'hello')

  buffer = appended.buffer
  appended = appendCommittedDictation(buffer, 'world')

  assert.equal(appended.insertText, ' world')
  assert.equal(appended.buffer.committedText, 'hello world')
})

test('manual cancel clears interim dictation and resets the buffer', () => {
  let buffer = createDictationBuffer()

  const interim = replaceInterimDictation(buffer, 'keep listening')
  buffer = interim.buffer

  const consumed = consumeTerminalInput(buffer, '\u0003')

  assert.equal(consumed.eraseText, '\u007f'.repeat('keep listening'.length))
  assert.deepEqual(consumed.buffer, createDictationBuffer())
})

test('manual submit resets the live dictation buffer for the next prompt', () => {
  let buffer = createDictationBuffer()

  buffer = appendCommittedDictation(buffer, 'hello').buffer
  buffer = replaceInterimDictation(buffer, 'there').buffer

  const consumed = consumeTerminalInput(buffer, '\r')

  assert.equal(consumed.eraseText, '')
  assert.deepEqual(consumed.buffer, createDictationBuffer())
})
