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
