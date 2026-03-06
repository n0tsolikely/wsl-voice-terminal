(function bootstrapMicState(root) {
  const MIC_MODES = {
    HOLD: 'hold',
    TOGGLE: 'toggle',
    AUTO: 'auto'
  }

  const MIC_PHASES = {
    IDLE: 'idle',
    ARMED: 'armed',
    RECORDING: 'recording',
    STOPPING: 'stopping',
    TRANSCRIBING: 'transcribing',
    INJECTED: 'injected',
    PLAYING: 'playing'
  }

  const AUTO_STRATEGIES = {
    LIVE: 'live',
    CAPTURE: 'capture'
  }

  const BUSY_PHASES = new Set([
    MIC_PHASES.RECORDING,
    MIC_PHASES.STOPPING,
    MIC_PHASES.TRANSCRIBING
  ])
  const ACTIVE_METER_PHASES = new Set([
    MIC_PHASES.ARMED,
    MIC_PHASES.RECORDING,
    MIC_PHASES.STOPPING
  ])

  function createMicState({
    mode = MIC_MODES.TOGGLE,
    liveDictationSupported = false,
    autoStrategy = AUTO_STRATEGIES.CAPTURE,
    autoEnabled = false
  } = {}) {
    return {
      mode,
      phase: resolveRestPhase({ mode, autoEnabled }),
      autoEnabled: mode === MIC_MODES.AUTO ? Boolean(autoEnabled) : false,
      autoStrategy,
      liveDictationSupported: Boolean(liveDictationSupported),
      playbackReturnPhase: null,
      recordingSource: null
    }
  }

  function transitionMicState(state, event) {
    switch (event.type) {
      case 'SET_MODE': {
        const nextMode = event.mode

        if (!Object.values(MIC_MODES).includes(nextMode)) {
          return state
        }

        const nextAutoEnabled = nextMode === MIC_MODES.AUTO ? state.autoEnabled : false
        const nextPhase = isPlaybackPhase(state.phase)
          ? state.phase
          : BUSY_PHASES.has(state.phase)
            ? state.phase
            : resolveRestPhase({
                mode: nextMode,
                autoEnabled: nextAutoEnabled,
                preserveInjected: state.phase === MIC_PHASES.INJECTED
              })

        return {
          ...state,
          mode: nextMode,
          autoEnabled: nextAutoEnabled,
          phase: nextPhase,
          playbackReturnPhase: isPlaybackPhase(nextPhase) ? state.playbackReturnPhase : null
        }
      }

      case 'AUTO_ARM':
        return {
          ...state,
          mode: MIC_MODES.AUTO,
          autoEnabled: true,
          phase: isPlaybackPhase(state.phase) ? state.phase : MIC_PHASES.ARMED
        }

      case 'AUTO_DISARM':
        return {
          ...state,
          autoEnabled: false,
          phase: isPlaybackPhase(state.phase)
            ? state.phase
            : BUSY_PHASES.has(state.phase)
              ? state.phase
              : resolveRestPhase({
                  ...state,
                  autoEnabled: false
                }),
          playbackReturnPhase: isPlaybackPhase(state.phase) ? MIC_PHASES.IDLE : null
        }

      case 'AUTO_STRATEGY_SET':
        return {
          ...state,
          autoStrategy: event.strategy || state.autoStrategy
        }

      case 'LIVE_DICTATION_SUPPORT_SET': {
        const nextSupported = Boolean(event.supported)

        return {
          ...state,
          liveDictationSupported: nextSupported,
          autoStrategy:
            !nextSupported && state.autoStrategy === AUTO_STRATEGIES.LIVE
              ? AUTO_STRATEGIES.CAPTURE
              : state.autoStrategy
        }
      }

      case 'RECORDING_STARTED':
        return {
          ...state,
          phase: MIC_PHASES.RECORDING,
          recordingSource: event.source || state.mode,
          playbackReturnPhase: null
        }

      case 'RECORDING_STOPPING':
        return {
          ...state,
          phase: MIC_PHASES.STOPPING
        }

      case 'TRANSCRIBING_STARTED':
        return {
          ...state,
          phase: MIC_PHASES.TRANSCRIBING
        }

      case 'TRANSCRIPTION_INJECTED':
        return {
          ...state,
          phase:
            state.mode === MIC_MODES.AUTO && state.autoEnabled
              ? MIC_PHASES.ARMED
              : MIC_PHASES.INJECTED,
          recordingSource: null
        }

      case 'TRANSCRIPTION_EMPTY':
      case 'RESET_TO_REST':
        return {
          ...state,
          phase: resolveRestPhase(state),
          recordingSource: null
        }

      case 'CLEAR_INJECTED':
        return {
          ...state,
          phase:
            state.phase === MIC_PHASES.INJECTED ? resolveRestPhase(state) : state.phase
        }

      case 'PLAYBACK_STARTED':
        return {
          ...state,
          phase: MIC_PHASES.PLAYING,
          playbackReturnPhase: state.phase
        }

      case 'PLAYBACK_FINISHED':
        return {
          ...state,
          phase: state.playbackReturnPhase || resolveRestPhase(state),
          playbackReturnPhase: null
        }

      default:
        return state
    }
  }

  function resolveRestPhase(
    { mode, autoEnabled, preserveInjected = false, phase } = {
      mode: MIC_MODES.TOGGLE,
      autoEnabled: false
    }
  ) {
    if (preserveInjected || phase === MIC_PHASES.INJECTED) {
      return MIC_PHASES.INJECTED
    }

    return mode === MIC_MODES.AUTO && autoEnabled ? MIC_PHASES.ARMED : MIC_PHASES.IDLE
  }

  function getMicButtonIntent(state, interaction) {
    if (interaction === 'pointerdown') {
      return state.mode === MIC_MODES.HOLD && canStartRecording(state.phase)
        ? 'start-recording'
        : 'none'
    }

    if (interaction === 'pointerup' || interaction === 'pointercancel') {
      return state.mode === MIC_MODES.HOLD && state.phase === MIC_PHASES.RECORDING
        ? 'stop-recording'
        : 'none'
    }

    if (interaction !== 'click') {
      return 'none'
    }

    if (state.mode === MIC_MODES.HOLD) {
      return 'focus-terminal'
    }

    if (state.mode === MIC_MODES.TOGGLE) {
      if (state.phase === MIC_PHASES.RECORDING) {
        return 'stop-recording'
      }

      return canStartRecording(state.phase) ? 'start-recording' : 'none'
    }

    if (state.mode === MIC_MODES.AUTO) {
      if (state.autoEnabled) {
        return 'disarm-auto'
      }

      return canArmAuto(state.phase) ? 'arm-auto' : 'none'
    }

    return 'none'
  }

  function getEnterIntentForMicState(state) {
    if (!shouldConsumeEnterForMicState(state)) {
      return 'pass-through'
    }

    if (state.phase === MIC_PHASES.RECORDING) {
      return 'stop-recording'
    }

    return 'consume-only'
  }

  function shouldConsumeEnterForMicState(state) {
    return (
      (state.mode === MIC_MODES.TOGGLE || state.mode === MIC_MODES.AUTO) &&
      (state.phase === MIC_PHASES.RECORDING ||
        state.phase === MIC_PHASES.STOPPING ||
        state.phase === MIC_PHASES.TRANSCRIBING)
    )
  }

  function getMicViewModel(state) {
    const phase = state.phase
    const busy = BUSY_PHASES.has(phase)
    const modeDescription = getModeDescription(state)

    return {
      buttonVisualState: getButtonVisualState(phase),
      buttonLabel: getButtonLabel(state),
      modeDescription,
      modeButtonsDisabled: busy,
      shouldShowMeter:
        ACTIVE_METER_PHASES.has(phase) &&
        (state.mode !== MIC_MODES.AUTO || state.autoEnabled || phase !== MIC_PHASES.ARMED),
      statusText: getStatusText(state),
      supportsLiveDictation: state.liveDictationSupported,
      usesLiveDictation:
        state.mode === MIC_MODES.AUTO && state.autoStrategy === AUTO_STRATEGIES.LIVE
    }
  }

  function getButtonVisualState(phase) {
    if (phase === MIC_PHASES.TRANSCRIBING) {
      return 'transcribing'
    }

    if (phase === MIC_PHASES.ARMED) {
      return 'armed'
    }

    if (phase === MIC_PHASES.RECORDING || phase === MIC_PHASES.STOPPING) {
      return 'recording'
    }

    if (phase === MIC_PHASES.PLAYING) {
      return 'playing'
    }

    return 'idle'
  }

  function getButtonLabel(state) {
    if (state.mode === MIC_MODES.HOLD) {
      return 'Hold to dictate'
    }

    if (state.mode === MIC_MODES.AUTO) {
      return state.autoEnabled ? 'Turn off always-on listening' : 'Turn on always-on listening'
    }

    return state.phase === MIC_PHASES.RECORDING ? 'Stop dictation' : 'Start dictation'
  }

  function getStatusText(state) {
    switch (state.phase) {
      case MIC_PHASES.ARMED:
        return 'Auto listening is on. Speak, pause, and it will send automatically.'

      case MIC_PHASES.RECORDING:
        if (state.recordingSource === MIC_MODES.AUTO) {
          return 'Auto capture is recording...'
        }

        if (state.mode === MIC_MODES.TOGGLE) {
          return 'Listening... press Enter or click mic to stop.'
        }

        return 'Recording...'

      case MIC_PHASES.STOPPING:
        return 'Finishing capture...'

      case MIC_PHASES.TRANSCRIBING:
        return 'Transcribing...'

      case MIC_PHASES.INJECTED:
        return state.mode === MIC_MODES.AUTO && state.autoEnabled
          ? 'Transcript injected. Auto listening stays on.'
          : 'Transcript injected. Press Enter to run.'

      case MIC_PHASES.PLAYING:
        return 'Playing response...'

      case MIC_PHASES.IDLE:
      default:
        if (state.mode === MIC_MODES.HOLD) {
          return state.liveDictationSupported
            ? 'Hold mic to talk. Words appear as you speak.'
            : 'Hold mic to talk.'
        }

        if (state.mode === MIC_MODES.AUTO) {
          return 'Click mic to arm always-on listening.'
        }

        return state.liveDictationSupported
          ? 'Click mic to talk. Words appear as you speak. Press Enter to stop.'
          : 'Click mic to talk. Press Enter to stop.'
    }
  }

  function getModeDescription(state) {
    if (state.mode === MIC_MODES.HOLD) {
      return state.liveDictationSupported
        ? 'Hold the mic button to talk. Dictation appears live, then final transcription settles when you release.'
        : 'Hold the mic button to record. Release to transcribe into the prompt.'
    }

    if (state.mode === MIC_MODES.TOGGLE) {
      return state.liveDictationSupported
        ? 'Click once to talk. Dictation appears live. Click again or press Enter to stop.'
        : 'Click once to record. Click again or press Enter to stop. Enter sends on the next press.'
    }

    if (!state.liveDictationSupported) {
      return 'Always listening is armed. Speak, pause, and it will transcribe then send automatically.'
    }

    if (state.autoStrategy === AUTO_STRATEGIES.CAPTURE) {
      return 'Always listening is armed. Speak, pause, and it will transcribe then send automatically.'
    }

    return 'Always listening is armed. Speak, pause, and it will transcribe then send automatically.'
  }

  function canStartRecording(phase) {
    return phase === MIC_PHASES.IDLE || phase === MIC_PHASES.INJECTED
  }

  function canArmAuto(phase) {
    return phase === MIC_PHASES.IDLE || phase === MIC_PHASES.INJECTED
  }

  function isPlaybackPhase(phase) {
    return phase === MIC_PHASES.PLAYING
  }

  const api = {
    AUTO_STRATEGIES,
    MIC_MODES,
    MIC_PHASES,
    createMicState,
    getEnterIntentForMicState,
    getMicButtonIntent,
    getMicViewModel,
    shouldConsumeEnterForMicState,
    transitionMicState
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalMicState = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
