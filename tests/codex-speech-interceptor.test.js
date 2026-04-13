const test = require('node:test')
const assert = require('node:assert/strict')

const { CodexSpeechInterceptor } = require('../lib/codex-speech-interceptor')

function createInterceptor(options = {}) {
  const emitted = []
  const interceptor = new CodexSpeechInterceptor(
    (text) => {
      emitted.push(text)
    },
    {
      schedule: () => 1,
      clearScheduled: () => {},
      idleMs: 1,
      ...options
    }
  )

  return { interceptor, emitted }
}

function createMetaInterceptor(options = {}) {
  const emitted = []
  const interceptor = new CodexSpeechInterceptor(
    (text, meta) => {
      emitted.push({ text, meta })
    },
    {
      schedule: () => 1,
      clearScheduled: () => {},
      idleMs: 1,
      ...options
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

test('finalizes stable repeated speech when boundary is missing', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n')
  interceptor.observeInput('Explain it\r')
  interceptor.observeOutput('This response lacks a visible prompt boundary.')

  assert.equal(interceptor.flush(), null)
  assert.equal(
    interceptor.flush(),
    'This response lacks a visible prompt boundary.'
  )
  assert.deepEqual(emitted, ['This response lacks a visible prompt boundary.'])
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

test('finalizes when Codex returns to a prompt with a pathless usage meter line', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n›Write tests for @filename\nGPT 5.3 Codex Spark 68% left\n')
  interceptor.observeInput('Explain it\r')
  interceptor.observeOutput(
    'Here is the final answer.\n›Write tests for @filename\nGPT 5.3 Codex Spark 68% left\n'
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

test('keeps the opening sentence when heavy footer redraw noise happens before trailing speech', () => {
  const { interceptor, emitted } = createInterceptor({
    maxCaptureChars: 30000
  })

  interceptor.observeOutput('OpenAI Codex\n› Explain this codebase\n')
  interceptor.observeInput('sync it\r')
  interceptor.observeOutput(
    'That makes sense, and it is a solid workflow if you keep one source of truth per update.\n'
  )
  interceptor.observeOutput(
    'gpt-5.3-codex medium · 100% left · /mnt/c/Users/peter\n'.repeat(1200)
  )
  interceptor.observeOutput(
    'I can also script this so one command does the whole sync with guardrails (no accidental overwrite, shows exactly what changed).\n› Explain this codebase\n'
  )

  assert.equal(
    interceptor.flush(),
    'That makes sense, and it is a solid workflow if you keep one source of truth per update. I can also script this so one command does the whole sync with guardrails (no accidental overwrite, shows exactly what changed).'
  )
  assert.deepEqual(emitted, [
    'That makes sense, and it is a solid workflow if you keep one source of truth per update. I can also script this so one command does the whole sync with guardrails (no accidental overwrite, shows exactly what changed).'
  ])
})

test('flushes conversational prose when a tool run starts', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('do the work\r')
  interceptor.observeOutput(
    'I confirmed the workspace and I’m creating a temp file now, then I’ll patch it and show a real unified diff.\n'
  )
  interceptor.observeOutput('• Ran pwd && ls -1\n└ /mnt/c/Users/peter\n')

  assert.deepEqual(emitted, [
    'I confirmed the workspace and I’m creating a temp file now, then I’ll patch it and show a real unified diff.'
  ])

  interceptor.observeOutput('Here is the final answer after the tool finished.\n› Implement {feature}\n')

  assert.equal(interceptor.flush(), 'Here is the final answer after the tool finished.')
  assert.deepEqual(emitted, [
    'I confirmed the workspace and I’m creating a temp file now, then I’ll patch it and show a real unified diff.',
    'Here is the final answer after the tool finished.'
  ])
})

test('treats search and read tool chatter as tool boundaries instead of spoken reply text', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Review the runtime\n')
  interceptor.observeInput('check the speech path\r')
  interceptor.observeOutput('I’m checking the runtime now and keeping the progress updates high level.\n')
  interceptor.observeOutput('● Searching renderer.js for status handling\n')
  interceptor.observeOutput('● Reading lib/terminal-speech.js\n')

  assert.deepEqual(emitted, [
    'I’m checking the runtime now and keeping the progress updates high level.'
  ])

  interceptor.observeOutput('I found the fix. The runtime should stop reading tool chatter now.\n› Review the runtime\n')

  assert.equal(
    interceptor.flush(),
    'I found the fix. The runtime should stop reading tool chatter now.'
  )
  assert.deepEqual(emitted, [
    'I’m checking the runtime now and keeping the progress updates high level.',
    'I found the fix. The runtime should stop reading tool chatter now.'
  ])
})

test('flushes conversational prose and speaks one approval summary when approval UI starts', () => {
  const { interceptor, emitted } = createMetaInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('clean it up\r')
  interceptor.observeOutput(
    'Diff is ready and shown. Now I’m doing the cleanup phase: deleting the temp files I made and verifying they’re gone.\n'
  )
  interceptor.observeOutput(
    [
      'Would you like to run the following command?',
      '$ rm -f /tmp/demo.py',
      '1. Yes, proceed',
      "2. Yes, and don't ask again for this exact command",
      '3. No, and tell Codex what to do differently',
      'Press enter to confirm or esc to cancel'
    ].join('\n')
  )

  assert.equal(emitted.length, 2)
  assert.equal(
    emitted[0].text,
    'Diff is ready and shown. Now I’m doing the cleanup phase: deleting the temp files I made and verifying they’re gone.'
  )
  assert.equal(emitted[0].meta.kind, 'checkpoint')
  assert.equal(emitted[0].meta.continueResponse, true)
  assert.equal(emitted[0].meta.forcedBoundary, 'approval')
  assert.equal(
    emitted[1].text,
    "Approval needed. Codex wants to run command: rm -f /tmp/demo.py. Effect: This will delete files or directories. Options: 1, yes proceed. 2, yes and don't ask again for this command. 3, no, and tell Codex what to do differently. Press Enter to confirm or Escape to cancel."
  )
  assert.equal(emitted[1].meta.kind, 'approval')
  assert.equal(emitted[1].meta.continueResponse, true)
  assert.equal(emitted[1].meta.forcedBoundary, 'approval')
  assert.equal(interceptor.pendingResponse, true)
})

test('flushes conversational prose before diff output starts', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('show the diff\r')
  interceptor.observeOutput(
    'File is created. I’m editing it now with a few real code changes, then I’ll print the diff.\n'
  )
  interceptor.observeOutput('diff --git a/demo.py b/demo.py\n@@ -1,1 +1,1 @@\n+print("updated")\n')

  assert.deepEqual(emitted, [
    'File is created. I’m editing it now with a few real code changes, then I’ll print the diff.'
  ])
  assert.equal(interceptor.pendingResponse, true)
})

test('flushes multiple conversational segments in one long work session', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('run the workflow\r')
  interceptor.observeOutput(
    'I confirmed the workspace and I’m creating a temp file in /mnt/c/Users/peter now, then I’ll patch it and show a real unified diff.\n'
  )
  interceptor.observeOutput('• Ran pwd && ls -1\n└ /mnt/c/Users/peter\n')

  interceptor.observeOutput(
    'File is created. I’m editing it now with a few real code changes, then I’ll print the diff.\n'
  )
  interceptor.observeOutput('diff --git a/demo.py b/demo.py\n@@ -1,1 +1,1 @@\n+print("updated")\n')

  interceptor.observeOutput(
    'now I’m deleting it: done. both temp files are gone (No such file or directory on ls confirms cleanup). › 1 tab to queue message 100% context left\n'
  )

  interceptor.observeOutput(
    'little response to end: test passed, your WSL voice terminal flow is working cleanly. › 1 tab to queue message 100% context left\n'
  )

  interceptor.observeOutput('Understood. I won’t run anything now. I’m just responding.\n› Implement {feature}\n')

  assert.equal(
    interceptor.flush(),
    'Understood. I won’t run anything now. I’m just responding.'
  )
  assert.deepEqual(emitted, [
    'I confirmed the workspace and I’m creating a temp file in /mnt/c/Users/peter now, then I’ll patch it and show a real unified diff.',
    'File is created. I’m editing it now with a few real code changes, then I’ll print the diff.',
    'I’m deleting it: done. both temp files are gone (No such file or directory on ls confirms cleanup).',
    'little response to end: test passed, your WSL voice terminal flow is working cleanly.',
    'Understood. I won’t run anything now. I’m just responding.'
  ])
})

test('does not duplicate a spoken segment when the same tool boundary redraw repeats', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('run it\r')
  interceptor.observeOutput('I confirmed the workspace and I’m creating a temp file now.\n')
  interceptor.observeOutput('• Ran pwd && ls -1\n')
  interceptor.observeOutput('• Ran pwd && ls -1\n')

  assert.deepEqual(emitted, ['I confirmed the workspace and I’m creating a temp file now.'])
})

test('marks tool-boundary narration as a continuing response and final reply as terminal', () => {
  const emitted = []
  const interceptor = new CodexSpeechInterceptor(
    (text, meta) => {
      emitted.push({ text, meta })
    },
    {
      schedule: () => 1,
      clearScheduled: () => {},
      idleMs: 1
    }
  )

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('run it\r')
  interceptor.observeOutput('I confirmed the workspace and I’m creating a temp file now.\n')
  interceptor.observeOutput('• Ran pwd && ls -1\n')
  interceptor.observeOutput('Here is the final assistant answer.\n› Implement {feature}\n')

  assert.equal(interceptor.flush(), 'Here is the final assistant answer.')
  assert.equal(emitted.length, 2)
  assert.equal(emitted[0].text, 'I confirmed the workspace and I’m creating a temp file now.')
  assert.equal(emitted[0].meta.continueResponse, true)
  assert.equal(emitted[0].meta.forcedBoundary, 'tool')
  assert.equal(emitted[0].meta.kind, 'checkpoint')
  assert.equal(emitted[1].text, 'Here is the final assistant answer.')
  assert.equal(emitted[1].meta.continueResponse, false)
  assert.equal(emitted[1].meta.kind, 'final')
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

test('does not finalize wrapped unsent draft fragments as assistant speech before enter is pressed', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.activeAssistant = 'codex'
  interceptor.pendingResponse = true

  interceptor.observeInput(
    'hey buddy i need you to check the runtime and tell me why the reply speech is double playing old segments instead of just reading the actual assistant messages'
  )
  interceptor.observeOutput(
    [
      '› hey buddy i need you to check the runtime and tell me why the',
      '  reply speech is double playing old segments instead of just',
      '  reading the actual assistant messages',
      '› Use /skills to list available skills'
    ].join('\n')
  )

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])
})

test('does not finalize queued user messages that are shown while a tool is still running', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.activeAssistant = 'codex'
  interceptor.pendingResponse = true
  interceptor.lastPromptHint = 'Write tests for @filename'

  interceptor.observeOutput(
    [
      '› so yeah, send that out and go check that out and then tell me what you come back with because i want to know because we need to fix this so i only get messages from you. i',
      "don't want all the garbage in between that isn't messages like when you say, ran codex version, approved this, blah, blah, blah, blah, blah. i just want your messages, that's",
      'it',
      '',
      '• I’m checking the wsl-voice-terminal repo and its runtime artifacts first, then I’ll trace where session output is being captured so I can tell you exactly why the non-message',
      'garbage is leaking through.',
      '• Ran rg -n "speech"'
    ].join('\n')
  )

  assert.deepEqual(emitted, [
    'I’m checking the wsl-voice-terminal repo and its runtime artifacts first, then I’ll trace where session output is being captured so I can tell you exactly why the non-message garbage is leaking through.'
  ])
})

test('does not finalize broken working-status redraw fragments as assistant speech', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.activeAssistant = 'codex'
  interceptor.pendingResponse = true
  interceptor.lastPromptHint = 'Write tests for @filename'

  interceptor.observeOutput('1 run ing · /ps to view · /stop to close\n')

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])
})

test('does not let command-looking prompt redraws overwrite the stored prompt hint', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Write tests for @filename\n')
  assert.equal(interceptor.lastPromptHint, 'Write tests for @filename')

  interceptor.observeInput('update codex\r')
  interceptor.observeOutput('› npm install -g /home/notsolikely/openclaw/.git/refs/heads/codex\n')

  assert.equal(interceptor.lastPromptHint, 'Write tests for @filename')

  interceptor.observeOutput('Write tests for @filename\n› Write tests for @filename\n')

  assert.equal(interceptor.flush(), null)
  assert.deepEqual(emitted, [])
})

test('speaks standalone model state changes but keeps model menus silent', () => {
  const { interceptor, emitted } = createMetaInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Use /skills to list available skills\n')
  interceptor.observeInput('/model\r')
  interceptor.observeOutput(
    [
      'Select Reasoning Level',
      '1. low',
      '2. medium',
      '3. high',
      '4. xhigh',
      '',
      'Model changed to gpt-5.4 xhigh',
      '› Use /skills to list available skills'
    ].join('\n')
  )

  assert.equal(interceptor.flush(), 'Model changed to gpt-5.4 xhigh')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].text, 'Model changed to gpt-5.4 xhigh')
  assert.equal(emitted[0].meta.kind, 'state_cue')
  assert.equal(emitted[0].meta.continueResponse, false)
})

test('combines split assistant prose across redraw chunks instead of emitting orphan fragments', () => {
  const { interceptor, emitted } = createInterceptor()

  interceptor.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  interceptor.observeInput('explain it\r')
  interceptor.observeOutput('I need the\n')
  interceptor.observeOutput('separate scripts rather than owning everything itself.\n› Implement {feature}\n')

  assert.equal(
    interceptor.flush(),
    'I need the separate scripts rather than owning everything itself.'
  )
  assert.deepEqual(emitted, ['I need the separate scripts rather than owning everything itself.'])
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

test('flushes Claude Code narration before a tool confirmation prompt and still speaks the later final reply', () => {
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
  assert.deepEqual(emitted, ["I've absorbed the context and I am checking the repo."])

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
  assert.deepEqual(emitted, [
    "I've absorbed the context and I am checking the repo.",
    'Here is the final answer after the tool finished.'
  ])
})
