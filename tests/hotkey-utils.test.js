const test = require('node:test')
const assert = require('node:assert/strict')

const {
  eventToHotkey,
  formatHotkeyLabel,
  isBindableHotkey,
  matchesHotkey,
  normalizeHotkey
} = require('../lib/hotkey-utils')

test('eventToHotkey normalizes modifier combos and function keys', () => {
  assert.equal(eventToHotkey({ key: 'm', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), 'Ctrl+M')
  assert.equal(eventToHotkey({ key: 'F8', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }), 'F8')
  assert.equal(eventToHotkey({ key: 'Shift', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false }), '')
})

test('normalizeHotkey canonicalizes stored values', () => {
  assert.equal(normalizeHotkey('ctrl+m'), 'Ctrl+M')
  assert.equal(normalizeHotkey(' shift + f9 '), 'Shift+F9')
  assert.equal(normalizeHotkey(''), '')
})

test('matchesHotkey compares normalized descriptors', () => {
  assert.equal(matchesHotkey({ key: 'm', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, 'Ctrl+M'), true)
  assert.equal(matchesHotkey({ key: 'M', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, 'Ctrl+M'), false)
})

test('isBindableHotkey allows function keys and modifier combos but rejects risky defaults', () => {
  assert.equal(isBindableHotkey('F8'), true)
  assert.equal(isBindableHotkey('Ctrl+M'), true)
  assert.equal(isBindableHotkey('M'), false)
  assert.equal(isBindableHotkey('Shift+M'), false)
  assert.equal(isBindableHotkey('Ctrl+C'), false)
  assert.equal(isBindableHotkey('Enter'), false)
})

test('formatHotkeyLabel returns a friendly fallback', () => {
  assert.equal(formatHotkeyLabel('ctrl+m'), 'Ctrl+M')
  assert.equal(formatHotkeyLabel('', 'Set hotkey'), 'Set hotkey')
})
