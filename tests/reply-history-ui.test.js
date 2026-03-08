const test = require('node:test')
const assert = require('node:assert/strict')

const {
  attachReplyAudio,
  shouldShowReplyHistory,
  trimReplyHistory,
  upsertReplyMessage
} = require('../lib/reply-history-ui')

test('upsertReplyMessage inserts new reply entries and ignores blank payloads', () => {
  const replyMessages = []

  assert.equal(upsertReplyMessage(replyMessages, { text: '  Hello  ', id: 'r1' }), true)
  assert.equal(replyMessages.length, 1)
  assert.equal(replyMessages[0].text, 'Hello')
  assert.equal(replyMessages[0].isVisible, false)
  assert.equal(replyMessages[0].pendingHideAfterPlayback, false)
  assert.equal(upsertReplyMessage(replyMessages, { text: '   ' }), false)
  assert.equal(replyMessages.length, 1)
})

test('attachReplyAudio updates an existing reply and fills in defaults', () => {
  const replyMessages = []
  upsertReplyMessage(replyMessages, { text: 'Hi', id: 'r1' })

  assert.equal(
    attachReplyAudio(replyMessages, {
      id: 'r1',
      text: 'Hi',
      audioBase64: 'abcd',
      provider: 'openai'
    }),
    true
  )

  assert.equal(replyMessages[0].audioBase64, 'abcd')
  assert.equal(replyMessages[0].mimeType, 'audio/mpeg')
  assert.equal(replyMessages[0].provider, 'openai')
})

test('trimReplyHistory and shouldShowReplyHistory keep reply rail state bounded', () => {
  const replyMessages = []
  for (let index = 0; index < 8; index += 1) {
    upsertReplyMessage(replyMessages, {
      text: `Reply ${index}`,
      id: `r${index}`
    })
  }

  trimReplyHistory(replyMessages, 3)

  assert.equal(replyMessages.length, 3)
  assert.deepEqual(
    replyMessages.map((message) => message.id),
    ['r7', 'r6', 'r5']
  )
  assert.equal(shouldShowReplyHistory(replyMessages, false, false), false)
  assert.equal(shouldShowReplyHistory(replyMessages, true, false), true)
  assert.equal(shouldShowReplyHistory([], true, true), false)
})
