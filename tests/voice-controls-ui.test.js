const test = require('node:test')
const assert = require('node:assert/strict')

const {
  formatModeLabel,
  getModeButtonLabel
} = require('../lib/voice-controls-ui')

test('formatModeLabel maps internal mic modes to UI labels', () => {
  assert.equal(formatModeLabel('hold'), 'PTT')
  assert.equal(formatModeLabel('toggle'), 'Click')
  assert.equal(formatModeLabel('auto'), 'Auto')
})

test('getModeButtonLabel explains each mode without changing behavior', () => {
  assert.match(getModeButtonLabel('hold', true), /PTT mode/i)
  assert.match(getModeButtonLabel('toggle', true), /Click mode/i)
  assert.match(getModeButtonLabel('auto', true), /Auto mode/i)
  assert.match(getModeButtonLabel('auto', false), /unavailable/i)
})
