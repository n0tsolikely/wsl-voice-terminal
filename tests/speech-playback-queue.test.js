const test = require('node:test')
const assert = require('node:assert/strict')

const { insertPlaybackItem } = require('../lib/speech-playback-queue')

test('insertPlaybackItem places approvals ahead of queued non-approval items', () => {
  const queue = [
    { id: 'checkpoint-1', kind: 'checkpoint' },
    { id: 'final-1', kind: 'final' }
  ]

  insertPlaybackItem(queue, { id: 'approval-1', kind: 'approval' })

  assert.deepEqual(
    queue.map((item) => item.id),
    ['approval-1', 'checkpoint-1', 'final-1']
  )
})

test('insertPlaybackItem preserves existing approval order and appends normal items', () => {
  const queue = [
    { id: 'approval-1', kind: 'approval' },
    { id: 'checkpoint-1', kind: 'checkpoint' }
  ]

  insertPlaybackItem(queue, { id: 'approval-2', kind: 'approval' })
  insertPlaybackItem(queue, { id: 'state-1', kind: 'state_cue' })

  assert.deepEqual(
    queue.map((item) => item.id),
    ['approval-1', 'approval-2', 'checkpoint-1', 'state-1']
  )
})
