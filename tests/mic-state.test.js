const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AUTO_STRATEGIES,
  MIC_MODES,
  MIC_PHASES,
  createMicState,
  getEnterIntentForMicState,
  getMicButtonIntent,
  getMicViewModel,
  shouldConsumeEnterForMicState,
  transitionMicState
} = require('../lib/mic-state')

test('Enter while click recording stops recording instead of passing through', () => {
  let state = createMicState({ mode: MIC_MODES.TOGGLE })

  state = transitionMicState(state, {
    type: 'RECORDING_STARTED',
    source: MIC_MODES.TOGGLE
  })

  assert.equal(state.phase, MIC_PHASES.RECORDING)
  assert.equal(getEnterIntentForMicState(state), 'stop-recording')
})

test('Enter while stopping or transcribing is consumed without sending to the PTY', () => {
  let stoppingState = createMicState({ mode: MIC_MODES.TOGGLE })

  stoppingState = transitionMicState(stoppingState, {
    type: 'RECORDING_STARTED',
    source: MIC_MODES.TOGGLE
  })
  stoppingState = transitionMicState(stoppingState, {
    type: 'RECORDING_STOPPING'
  })

  assert.equal(shouldConsumeEnterForMicState(stoppingState), true)
  assert.equal(getEnterIntentForMicState(stoppingState), 'consume-only')

  let transcribingState = createMicState({ mode: MIC_MODES.AUTO, autoEnabled: true })

  transcribingState = transitionMicState(transcribingState, {
    type: 'TRANSCRIBING_STARTED'
  })

  assert.equal(shouldConsumeEnterForMicState(transcribingState), true)
  assert.equal(getEnterIntentForMicState(transcribingState), 'consume-only')
})

test('Hold mode starts on pointer down and stops on release', () => {
  const holdState = createMicState({ mode: MIC_MODES.HOLD })

  assert.equal(getMicButtonIntent(holdState, 'pointerdown'), 'start-recording')

  const recordingState = transitionMicState(holdState, {
    type: 'RECORDING_STARTED',
    source: MIC_MODES.HOLD
  })

  assert.equal(getMicButtonIntent(recordingState, 'pointerup'), 'stop-recording')
  assert.equal(getMicButtonIntent(recordingState, 'pointercancel'), 'stop-recording')
})

test('Auto mode arm and disarm transitions stay explicit', () => {
  let state = createMicState({
    mode: MIC_MODES.AUTO,
    autoEnabled: false,
    liveDictationSupported: true
  })

  state = transitionMicState(state, { type: 'AUTO_ARM' })
  assert.equal(state.autoEnabled, true)
  assert.equal(state.phase, MIC_PHASES.ARMED)
  assert.equal(getMicViewModel(state).statusText, 'Auto listening is on. Speak and text should appear as you talk.')

  state = transitionMicState(state, {
    type: 'RECORDING_STARTED',
    source: MIC_MODES.AUTO
  })
  state = transitionMicState(state, { type: 'AUTO_DISARM' })

  assert.equal(state.autoEnabled, false)
  assert.equal(state.phase, MIC_PHASES.RECORDING)

  state = transitionMicState(state, { type: 'RECORDING_STOPPING' })
  state = transitionMicState(state, { type: 'TRANSCRIPTION_EMPTY' })

  assert.equal(state.phase, MIC_PHASES.IDLE)
})

test('Auto transcript injection returns to armed listening instead of looking idle', () => {
  let state = createMicState({
    mode: MIC_MODES.AUTO,
    autoEnabled: true,
    liveDictationSupported: true,
    autoStrategy: AUTO_STRATEGIES.LIVE
  })

  state = transitionMicState(state, {
    type: 'RECORDING_STARTED',
    source: MIC_MODES.AUTO
  })
  state = transitionMicState(state, { type: 'TRANSCRIBING_STARTED' })
  state = transitionMicState(state, { type: 'TRANSCRIPTION_INJECTED' })

  assert.equal(state.phase, MIC_PHASES.ARMED)
  assert.equal(getMicViewModel(state).buttonVisualState, 'armed')
})

test('state view model exposes consistent status text for busy and injected phases', () => {
  let state = createMicState({ mode: MIC_MODES.TOGGLE })

  assert.equal(getMicViewModel(state).statusText, 'Click mic to talk. Press Enter to stop.')

  state = transitionMicState(state, {
    type: 'RECORDING_STARTED',
    source: MIC_MODES.TOGGLE
  })
  assert.equal(getMicViewModel(state).statusText, 'Listening... press Enter or click mic to stop.')

  state = transitionMicState(state, { type: 'RECORDING_STOPPING' })
  assert.equal(getMicViewModel(state).statusText, 'Finishing capture...')

  state = transitionMicState(state, { type: 'TRANSCRIBING_STARTED' })
  assert.equal(getMicViewModel(state).statusText, 'Transcribing...')

  state = transitionMicState(state, { type: 'TRANSCRIPTION_INJECTED' })
  assert.equal(getMicViewModel(state).statusText, 'Transcript injected. Press Enter to run.')
})
