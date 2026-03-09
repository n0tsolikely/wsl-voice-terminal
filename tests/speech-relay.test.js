const test = require('node:test')
const assert = require('node:assert/strict')

const { SpeechRelay } = require('../lib/speech-relay')

test('emits finalized text first, then speech audio after Codex output reaches a real completion boundary', async () => {
  const sent = []
  const relay = new SpeechRelay({
    ttsService: {
      synthesizeSpeech: async () => ({
        audioBuffer: Buffer.from('voice-bytes'),
        mimeType: 'audio/mpeg',
        provider: 'fake'
      })
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
    }
  })

  relay.observeInput('codex exec "hi"\r')
  relay.observeOutput('Here is the fix.\n```js\nconsole.log("ignore")\n```')
  await relay.flush()

  assert.deepEqual(sent, [])

  relay.observeOutput('\nIt keeps the command line clean.\nuser@host:~/repo$ ')
  await relay.flush()
  relay.dispose()

  assert.equal(sent.length, 2)
  assert.equal(sent[0].channel, 'speech:finalized')
  assert.equal(sent[0].payload.text, 'Here is the fix. It keeps the command line clean.')
  assert.equal(sent[1].channel, 'speech:audio')
  assert.equal(sent[1].payload.text, 'Here is the fix. It keeps the command line clean.')
  assert.equal(sent[1].payload.id, sent[0].payload.id)
  assert.equal(sent[1].payload.audioBase64, Buffer.from('voice-bytes').toString('base64'))
})

test('sends finalized text and then app:error if TTS synthesis fails', async () => {
  const sent = []
  const relay = new SpeechRelay({
    ttsService: {
      synthesizeSpeech: async () => {
        throw new Error('tts broke')
      }
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
    }
  })

  relay.observeInput('codex exec "hi"\r')
  relay.observeOutput('This is the final answer.\nuser@host:~/repo$ ')
  await relay.flush()
  relay.dispose()

  assert.equal(sent.length, 2)
  assert.deepEqual(sent[0], {
    channel: 'speech:finalized',
    payload: {
      id: sent[0].payload.id,
      text: 'This is the final answer.'
    }
  })
  assert.deepEqual(sent[1], {
    channel: 'app:error',
    payload: { message: 'tts broke' }
  })
})

test('sends a status notice when OpenAI TTS falls back to local voice', async () => {
  const sent = []
  const relay = new SpeechRelay({
    ttsService: {
      synthesizeSpeech: async () => ({
        audioBuffer: Buffer.from('voice-bytes'),
        mimeType: 'audio/wav',
        provider: 'local',
        fallbackFrom: 'openai'
      })
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
    }
  })

  relay.observeInput('codex exec "hi"\r')
  relay.observeOutput('This is the final answer.\nuser@host:~/repo$ ')
  await relay.flush()
  relay.dispose()

  assert.equal(sent[0].channel, 'speech:finalized')
  assert.deepEqual(sent[1], {
    channel: 'app:status',
    payload: { message: 'OpenAI TTS was unavailable. Using local Windows voice.' }
  })
  assert.equal(sent[2].channel, 'speech:audio')
  assert.equal(sent[2].payload.id, sent[0].payload.id)
})

test('still emits finalized text but skips TTS audio when auto reply speech is disabled', async () => {
  const sent = []
  let synthesisCalls = 0
  const relay = new SpeechRelay({
    ttsService: {
      synthesizeSpeech: async () => {
        synthesisCalls += 1
        return {
          audioBuffer: Buffer.from('voice-bytes'),
          mimeType: 'audio/mpeg',
          provider: 'fake'
        }
      }
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
    }
  })

  relay.setAutoReplySpeechEnabled(false)
  relay.observeInput('codex exec "hi"\r')
  relay.observeOutput('This is the final answer.\nuser@host:~/repo$ ')
  await relay.flush()
  relay.dispose()

  assert.equal(synthesisCalls, 0)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].channel, 'speech:finalized')
  assert.equal(sent[0].payload.text, 'This is the final answer.')
})

test('collapses tool-handoff narration into one final spoken reply', async () => {
  const sent = []
  const relay = new SpeechRelay({
    ttsService: {
      synthesizeSpeech: async (text) => ({
        audioBuffer: Buffer.from(text),
        mimeType: 'audio/mpeg',
        provider: 'fake'
      })
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
    }
  })

  relay.observeOutput('OpenAI Codex\n› Implement {feature}\n')
  relay.observeInput('run the workflow\r')
  relay.observeOutput(
    'I confirmed the workspace and I’m creating a temp file now, then I’ll patch it and show a real unified diff.\n'
  )
  relay.observeOutput('• Ran pwd && ls -1\n└ /mnt/c/Users/peter\n')
  relay.observeOutput(
    'File is created. I’m editing it now with a few real code changes, then I’ll print the diff.\n'
  )
  relay.observeOutput('diff --git a/demo.py b/demo.py\n@@ -1,1 +1,1 @@\n+print("updated")\n')
  relay.observeOutput(
    'Diff is ready and shown. Now I’m doing the cleanup phase: deleting the temp files I made and verifying they’re gone.\n'
  )
  relay.observeOutput('Would you like to run the following command?\n$ rm -f /tmp/demo.py\nPress enter to confirm or esc to cancel\n')
  relay.observeOutput('Here is the final answer after the tool finished.\n› Implement {feature}\n')
  await relay.flush()
  relay.dispose()

  assert.equal(sent.length, 2)
  assert.equal(sent[0].channel, 'speech:finalized')
  assert.equal(
    sent[0].payload.text,
    'I confirmed the workspace and I’m creating a temp file now, then I’ll patch it and show a real unified diff. File is created. I’m editing it now with a few real code changes, then I’ll print the diff. Diff is ready and shown. Now I’m doing the cleanup phase: deleting the temp files I made and verifying they’re gone. Here is the final answer after the tool finished.'
  )
  assert.equal(sent[1].channel, 'speech:audio')
  assert.equal(sent[1].payload.id, sent[0].payload.id)
  assert.equal(
    Buffer.from(sent[1].payload.audioBase64, 'base64').toString('utf8'),
    sent[0].payload.text
  )
})
