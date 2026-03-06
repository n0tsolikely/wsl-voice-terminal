const test = require('node:test')
const assert = require('node:assert/strict')

const { SpeechRelay } = require('../lib/speech-relay')

test('emits a speech event only after Codex output reaches a real completion boundary', async () => {
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

  assert.equal(sent.length, 1)
  assert.equal(sent[0].channel, 'speech:audio')
  assert.equal(sent[0].payload.text, 'Here is the fix. It keeps the command line clean.')
  assert.equal(sent[0].payload.audioBase64, Buffer.from('voice-bytes').toString('base64'))
})

test('sends an app:error event if TTS synthesis fails', async () => {
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

  assert.deepEqual(sent, [
    {
      channel: 'app:error',
      payload: { message: 'tts broke' }
    }
  ])
})
