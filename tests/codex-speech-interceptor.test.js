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
  assert.equal(interceptor.activeAssistant, null)
})

test('finalizes when the alternate screen exits even if no prompt text is visible', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('codex exec "hi"\r')
  interceptor.observeOutput('Here is the final answer.\n\u001b[?1049l')

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.deepEqual(emitted, ['Here is the final answer.'])
})

test('finalizes when Codex returns to a prompt line with placeholder text', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Write tests for @filename\n')
  interceptor.observeInput('Explain it\r')
  interceptor.observeOutput('Here is the final answer.\n› Write tests for @filename\n')

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.deepEqual(emitted, ['Here is the final answer.'])
})

test('finalizes when Codex returns to a prompt with no space and a footer line', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n›Write tests for @filename\n  gpt-5.4 xhigh · 93% left · /mnt/c/Users/peter\n')
  interceptor.observeInput('Explain it\r')
  interceptor.observeOutput(
    'Here is the final answer.\n›Write tests for @filename\n  gpt-5.4 xhigh · 93% left · /mnt/c/Users/peter\n'
  )

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.deepEqual(emitted, ['Here is the final answer.'])
})

test('finalizes short Codex replies when the prompt returns', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.observeInput('hello\r')
  interceptor.observeOutput('• Hello.\n› Use /skills to list available skills\n')

  assert.equal(interceptor.flush(), 'Hello.')
  assert.deepEqual(emitted, ['Hello.'])
})

test('does not finalize Codex prompt placeholder text as a reply before the real answer arrives', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Write tests for @filename\n')
  interceptor.observeInput('hey\r')
  interceptor.observeOutput(
    [
      '› hey',
      '',
      'Write tests for @filename',
      '',
      '• Working (0s • esc to interrupt)',
      '',
      '› Write tests for @filename',
      'gpt-5.4 xhigh · 100% left · /mnt/c/Users/peter'
    ].join('\n')
  )

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])

  interceptor.observeOutput(
    [
      'Here is the real assistant reply.',
      'It should be spoken instead of the prompt hint.',
      '› Write tests for @filename'
    ].join('\n')
  )

  assert.equal(
    interceptor.flush(),
    'Here is the real assistant reply. It should be spoken instead of the prompt hint.'
  )
  assert.deepEqual(emitted, [
    'Here is the real assistant reply. It should be spoken instead of the prompt hint.'
  ])
})

test('finalizes a continued Codex reply when the footer redraw is glued to the follow-on sentence', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.observeInput('hello\r')
  interceptor.observeOutput(
    '• Yes. Your last message came through clearly.\n› Use /skills to list available skills\n  gpt-5.4 xhigh · 100% left · /mnt/c/Users/peter'
  )
  interceptor.observeOutput(
    '  Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand.'
  )

  assert.equal(
    interceptor.flush(),
    'Yes. Your last message came through clearly. Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand.'
  )
  assert.deepEqual(emitted, [
    'Yes. Your last message came through clearly. Only minor issue: it merged interfaceHey without a space, but the rest was easy to understand.'
  ])
})

test('finalizes a Codex reply when the prompt redraw happens before a trailing follow-up line', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('i said a paragraph.. reply with two seperate liones\r')
  interceptor.observeOutput(
    "• I'm doing well today, staying focused and ready to help with whatever you need.\n› Implement {feature}\n  gpt-5.4 xhigh · 100% left · /mnt/c/Users/peter\n› Implement {feature}\n  gpt-5.4 xhigh · 100% left · /mnt/c/Users/peter\n  How are you doing?\n"
  )

  assert.equal(
    interceptor.flush(),
    "I'm doing well today, staying focused and ready to help with whatever you need. How are you doing?"
  )
  assert.deepEqual(emitted, [
    "I'm doing well today, staying focused and ready to help with whatever you need. How are you doing?"
  ])
})

test('does not speak echoed user input when Codex redraws it before the reply', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.observeInput('check runtime and fix tts\r')
  interceptor.observeOutput(
    [
      'check runtime and fix tts',
      '',
      'Yes. I found the speech extraction issue.',
      '',
      'I will only read the assistant reply now.',
      '› Use /skills to list available skills'
    ].join('\n')
  )

  assert.equal(
    interceptor.flush(),
    'Yes. I found the speech extraction issue. I will only read the assistant reply now.'
  )
  assert.deepEqual(emitted, [
    'Yes. I found the speech extraction issue. I will only read the assistant reply now.'
  ])
})

test('does not finalize unsent draft input as assistant speech before enter is pressed', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.activeAssistant = 'codex'
  interceptor.pendingResponse = true

  interceptor.observeInput('hey, how are you? test')
  interceptor.observeOutput('hey, how are you? test\n› Use /skills to list available skills\n')

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])

  interceptor.observeInput('\r')
  interceptor.observeOutput(
    'Fine. I’m here and responding normally. Your test message came through.\n› Use /skills to list available skills\n'
  )

  assert.equal(
    interceptor.flush(),
    'Fine. I’m here and responding normally. Your test message came through.'
  )
  assert.deepEqual(emitted, ['Fine. I’m here and responding normally. Your test message came through.'])
})

test('ignores terminal focus escape sequences when tracking draft input', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.observeInput('\u001b[O')
  interceptor.observeInput('hello there')
  interceptor.observeInput('\u001b[I')

  assert.equal(interceptor.inputBuffer, 'hello there')

  interceptor.activeAssistant = 'codex'
  interceptor.pendingResponse = true
  interceptor.observeOutput('hello there\n› Use /skills to list available skills\n')

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])
})

test('does not emit duplicates when flushed repeatedly after completion', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('codex exec "hi"\r')
  interceptor.observeOutput('Here is the final answer.\nuser@host:~/repo$ ')

  assert.equal(interceptor.flush(), 'Here is the final answer.')
  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, ['Here is the final answer.'])
})

test('finalizes Claude Code replies when the prompt and shortcuts footer return', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('claude\r')
  interceptor.observeOutput('Claude Code\n❯ \n? for shortcuts\n')
  interceptor.observeInput('hello\r')
  interceptor.observeOutput("● Hey! I've read the repo and I can help.\n❯ \n? for shortcuts\n")

  assert.equal(interceptor.flush(), "Hey! I've read the repo and I can help.")
  assert.deepEqual(emitted, ["Hey! I've read the repo and I can help."])
})

test('does not finalize Claude Code tool confirmation prompts as completed replies', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeInput('claude\r')
  interceptor.observeOutput('Claude Code\n❯ \n? for shortcuts\n')
  interceptor.observeInput('check the repo\r')
  interceptor.observeOutput(
    [
      "● I've absorbed the context and I am checking the repo.",
      '● Bash(cd /repo)',
      '❯ 1. Yes',
      'Esc to cancel · Tab to amend · ctrl+e to explain'
    ].join('\n')
  )

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])

  interceptor.observeOutput(
    [
      '',
      '● Here is the final answer after the tool finished.',
      '❯ ',
      '? for shortcuts'
    ].join('\n')
  )

  const finalized = interceptor.flush()

  assert.match(finalized, /Here is the final answer after the tool finished\./)
  assert.doesNotMatch(finalized, /Esc to cancel/)
  assert.equal(emitted.length, 1)
})
