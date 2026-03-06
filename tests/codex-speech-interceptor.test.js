const test = require('node:test')
const assert = require('node:assert/strict')

const { CodexSpeechInterceptor } = require('../lib/codex-speech-interceptor')

function createInterceptor() {
  const emitted = []
  const interceptor = new CodexSpeechInterceptor(
    (text) => {
      emitted.push(text)
    },
    {
      schedule: () => 1,
      clearScheduled: () => {},
      idleMs: 1
    }
  )

  return { interceptor, emitted }
}

test('does not finalize a long partial reply until a prompt boundary returns', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n>\n')
  interceptor.observeInput('Explain the fix\r')
  interceptor.observeOutput(
    'This is a long answer. It has plenty of words and punctuation, but there is no prompt yet.'
  )

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])

  interceptor.observeOutput('\nIt keeps going until Codex gives control back.\n>\n')

  assert.equal(
    interceptor.flush(),
    'This is a long answer. It has plenty of words and punctuation, but there is no prompt yet. It keeps going until Codex gives control back.'
  )
  assert.deepEqual(emitted, [
    'This is a long answer. It has plenty of words and punctuation, but there is no prompt yet. It keeps going until Codex gives control back.'
  ])
})

test('finalizes when a shell prompt returns after a one-shot codex command', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('codex exec "hi"\r')
  interceptor.observeOutput('Here is the final answer.\nuser@host:~/repo$ ')

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.deepEqual(emitted, ['Here is the final answer.'])
  assert.equal(interceptor.codexSessionActive, false)
})

test('finalizes when the alternate screen exits even if no prompt text is visible', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('codex exec "hi"\r')
  interceptor.observeOutput('Here is the final answer.\n\u001b[?1049l')

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.deepEqual(emitted, ['Here is the final answer.'])
})

test('does not emit duplicates when flushed repeatedly after completion', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('codex exec "hi"\r')
  interceptor.observeOutput('Here is the final answer.\nuser@host:~/repo$ ')

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, ['Here is the final answer.'])
})
