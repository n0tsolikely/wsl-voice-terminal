const test = require('node:test')
const assert = require('node:assert/strict')

const { applyDevDictionary } = require('../lib/dev-dictionary')

test('developer dictionary corrects spoken code phrases deterministically', () => {
  assert.equal(
    applyDevDictionary('create a snake case variable user id and open bracket close bracket'),
    'create a snake_case variable user_id and ()'
  )
})

test('developer dictionary corrects common tool-name hallucinations', () => {
  assert.equal(
    applyDevDictionary('open co decks from get hub and ask cloud code'),
    'open codex from GitHub and ask Claude Code'
  )
})
