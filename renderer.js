(function bootstrap() {
  const api = window.terminalAPI
  const micStateApi = window.WslVoiceTerminalMicState
  const dictationApi = window.WslVoiceTerminalDictationBuffer
  const terminalElement = document.getElementById('terminal')
  const replyHistoryElement = document.getElementById('replyHistory')
  const controlPanel = document.getElementById('controlPanel')
  const micButton = document.getElementById('micButton')
  const speakerButton = document.getElementById('speakerButton')
  const statusElement = document.getElementById('status')
  const modeDetailElement = document.getElementById('modeDetail')
  const meterElement = document.getElementById('meter')
  const modeButtons = Array.from(document.querySelectorAll('.modeButton'))
  const meterBars = Array.from(document.querySelectorAll('.meterBar'))
  const fitAddon = new window.FitAddon.FitAddon()
  const terminal = new window.Terminal({
    allowTransparency: true,
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 14,
    scrollback: 10000,
    theme: {
      background: '#111111',
      foreground: '#f3f3f3'
    }
  })
  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition || null
  const AudioContextClass = window.AudioContext || window.webkitAudioContext || null
  const {
    AUTO_STRATEGIES,
    MIC_MODES,
    MIC_PHASES,
    createMicState,
    getEnterIntentForMicState,
    getMicButtonIntent,
    getMicViewModel,
    transitionMicState
  } = micStateApi
  const {
    appendCommittedDictation,
    appendWords,
    clearInterimDictation,
    commitInterimDictation,
    consumeTerminalInput,
    createDictationBuffer,
    getRenderedInterimText,
    normalizeDictationText,
    replaceInterimDictation
  } = dictationApi
  const AUTO_MIN_START_THRESHOLD = 0.02
  const AUTO_MIN_CONTINUE_THRESHOLD = 0.014
  const AUTO_START_MARGIN = 0.008
  const AUTO_CONTINUE_MARGIN = 0.004
  const AUTO_START_HOLD_MS = 140
  const AUTO_STOP_SILENCE_MS = 900
  const AUTO_NOISE_FLOOR_ALPHA = 0.08
  const MIN_RECORDING_MS = 320
  const PLAYBACK_COOLDOWN_MS = 450
  const LIVE_DICTATION_FALLBACK_MS = 650
  const LIVE_RESULT_GRACE_MS = 900
  const LIVE_STOP_WAIT_MS = 900
  const REPLY_HISTORY_LIMIT = 6
  const STATUS_NOTICE_MS = 2600
  const BUSY_PHASES = new Set([
    MIC_PHASES.RECORDING,
    MIC_PHASES.STOPPING,
    MIC_PHASES.TRANSCRIBING
  ])
  const runtimeSupport = {
    capture: Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
    liveDictation: Boolean(SpeechRecognitionClass),
    meter: Boolean(AudioContextClass)
  }

  let micState = createMicState({
    mode: MIC_MODES.TOGGLE,
    liveDictationSupported: runtimeSupport.liveDictation
  })
  let dictationBuffer = createDictationBuffer()
  let mediaStream = null
  let mediaRecorder = null
  let speechRecognition = null
  let liveDictationSession = null
  let currentCapture = null
  let activePointerId = null
  let pendingHoldStop = false
  let isStartingRecording = false
  let liveRecognitionRestartTimer = 0
  let voiceCandidateSince = 0
  let lastVoiceAt = 0
  let liveFallbackVoiceSince = 0
  let lastLiveResultAt = 0
  let playbackQuietUntil = 0
  let audioContext = null
  let analyser = null
  let sourceNode = null
  let frequencyData = null
  let timeDomainData = null
  let meterAnimationFrame = 0
  let statusOverride = null
  let statusOverrideTimer = 0
  let isPreviewRequestPending = false
  let autoNoiseFloor = AUTO_MIN_CONTINUE_THRESHOLD * 0.5
  let activeReplyPlaybackId = ''
  const playbackQueue = []
  const replyMessages = []
  let isPlayingAudio = false

  terminal.loadAddon(fitAddon)
  terminal.open(terminalElement)
  fitAddon.fit()
  focusTerminal()
  logRuntime('renderer.start', {
    runtimeSupport
  })
  terminal.attachCustomKeyEventHandler((event) => {
    if (
      event.type === 'keydown' &&
      event.key?.toLowerCase() === 'c' &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      terminal.hasSelection()
    ) {
      event.preventDefault()
      event.stopPropagation()
      copyTerminalSelection().catch((error) => {
        setStatus(error.message, 'error')
      })
      return false
    }

    if (
      event.type === 'keydown' &&
      event.key?.toLowerCase() === 'v' &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey
    ) {
      event.preventDefault()
      event.stopPropagation()
      pasteClipboardText().catch((error) => {
        setStatus(error.message, 'error')
      })
      return false
    }

    const enterIntent = getEnterIntentForMicState(micState)

    if (event.type === 'keydown' && event.key === 'Enter' && enterIntent !== 'pass-through') {
      event.preventDefault()
      event.stopPropagation()

      if (enterIntent === 'stop-recording') {
        stopRecording({
          reason: 'manual-enter',
          keepAutoArmed: isAutoArmed()
        })
      } else {
        renderUi()
      }

      return false
    }

    return true
  })

  api.onPtyData((data) => {
    terminal.write(data)
  })

  api.onPtyExit((event) => {
    setStatus(`WSL session exited (${event.exitCode ?? 'unknown'}).`, 'error')
  })

  api.onError((payload) => {
    setStatus(payload.message, 'error')
  })

  api.onSpeechFinalized((payload) => {
    registerReplyMessage(payload)
  })

  api.onSpeechAudio((payload) => {
    registerReplyAudio(payload)
    enqueueSpeech(payload)
  })

  api.onStatus((payload) => {
    if (!payload?.message) {
      return
    }

    setStatus(payload.message, 'default', {
      durationMs: 3800,
      persistDuringBusy: true
    })
  })

  api
    .startPty({ cols: terminal.cols, rows: terminal.rows })
    .catch((error) => setStatus(error.message, 'error'))

  terminal.onData((data) => {
    handleManualTerminalInput(data)
    api.writeToPty(data)
  })

  window.addEventListener('resize', debounce(resizeTerminal, 80))
  window.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain')

    if (!text) {
      return
    }

    event.preventDefault()
    writePastedText(text)
  })

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setMicMode(button.dataset.mode)
      focusTerminal()
    })
  })

  speakerButton.addEventListener('click', async () => {
    if (isPreviewRequestPending) {
      focusTerminal()
      return
    }

    try {
      isPreviewRequestPending = true
      renderUi()
      setStatus('Requesting test voice...', 'default', {
        sticky: true,
        persistDuringBusy: true
      })

      const payload = await api.previewSpeech({
        text: 'Speaker test. If you can hear this, terminal audio output is working.'
      })

      if (!payload.audioBase64) {
        throw new Error('The TTS test returned no audio.')
      }

      clearStatus({ preserveErrors: false })
      enqueueSpeech(payload)
    } catch (error) {
      setStatus(error.message, 'error')
    } finally {
      isPreviewRequestPending = false
      renderUi()
      focusTerminal()
    }
  })

  micButton.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0) {
      return
    }

    const intent = getMicButtonIntent(micState, 'pointerdown')

    if (intent !== 'start-recording') {
      return
    }

    event.preventDefault()

    if (activePointerId !== null) {
      return
    }

    activePointerId = event.pointerId
    pendingHoldStop = false
    micButton.setPointerCapture(event.pointerId)

    try {
      await handleMicIntent(intent, { source: MIC_MODES.HOLD })
    } catch (error) {
      releaseMicPointerCapture(event.pointerId)
      activePointerId = null
      setStatus(error.message, 'error')
    } finally {
      focusTerminal()
    }
  })

  micButton.addEventListener('pointerup', (event) => {
    if (event.pointerId !== activePointerId) {
      return
    }

    releaseMicPointerCapture(event.pointerId)

    if (isStartingRecording) {
      pendingHoldStop = true
      activePointerId = null
      return
    }

    if (getMicButtonIntent(micState, 'pointerup') === 'stop-recording') {
      stopRecording({ reason: 'hold-release' })
    }
  })

  micButton.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== activePointerId) {
      return
    }

    releaseMicPointerCapture(event.pointerId)

    if (isStartingRecording) {
      pendingHoldStop = true
      activePointerId = null
      return
    }

    if (getMicButtonIntent(micState, 'pointercancel') === 'stop-recording') {
      stopRecording({ reason: 'hold-cancel' })
    }
  })

  micButton.addEventListener('click', async (event) => {
    event.preventDefault()

    const intent = getMicButtonIntent(micState, 'click')

    try {
      await handleMicIntent(intent)
    } catch (error) {
      setStatus(error.message, 'error')
    } finally {
      focusTerminal()
    }
  })

  initializeUi()

  async function handleMicIntent(intent, { source = micState.mode } = {}) {
    logRuntime('mic.intent', {
      intent,
      source,
      mode: micState.mode
    })

    switch (intent) {
      case 'focus-terminal':
        return
      case 'start-recording':
        await startRecording({ source })
        return
      case 'stop-recording':
        stopRecording({
          reason: 'manual-click',
          keepAutoArmed: isAutoArmed()
        })
        return
      case 'arm-auto':
        await enableAutoListening()
        return
      case 'disarm-auto':
        disableAutoListening()
        return
      default:
        return
    }
  }

  async function startRecording({ source, keepAutoArmed = false }) {
    if (isRecording() || isStartingRecording || isBusyMicPhase(micState.phase)) {
      return
    }

    clearStatus({ preserveErrors: false })
    isStartingRecording = true
    renderUi()
    setStatus('Opening mic...', 'default', {
      sticky: true,
      persistDuringBusy: true
    })

    try {
      await ensureMicrophoneReady()

      if (!window.MediaRecorder) {
        throw new Error('MediaRecorder is not available in this Electron runtime.')
      }

      const chunks = []
      const recorder = new MediaRecorder(mediaStream, pickRecorderOptions())
      const capture = {
        keepAutoArmed,
        source,
        startedAt: performance.now()
      }

      mediaRecorder = recorder
      currentCapture = capture
      lastVoiceAt = capture.startedAt
      voiceCandidateSince = 0

      if (source !== MIC_MODES.AUTO) {
        dictationBuffer = createDictationBuffer()
      }

      recorder.addEventListener('dataavailable', (captureEvent) => {
        if (captureEvent.data.size > 0) {
          chunks.push(captureEvent.data)
        }
      })

      recorder.addEventListener(
        'stop',
        async () => {
          const mimeType = recorder.mimeType || 'audio/webm'
          const captureSource = currentCapture?.source || source
          const shouldResumeAuto = Boolean(currentCapture?.keepAutoArmed) && isAutoArmed()
          const shouldAutoSubmit = shouldResumeAuto && captureSource === MIC_MODES.AUTO
          const pointerId = activePointerId

          currentCapture = null
          mediaRecorder = null
          activePointerId = null
          pendingHoldStop = false
          releaseMicPointerCapture(pointerId)

          try {
            const blob = new Blob(chunks, { type: mimeType })
            const liveSnapshot =
              captureSource === MIC_MODES.AUTO
                ? null
                : await stopLiveDictation({
                    keepTypedText: true
                  })

            if (blob.size === 0) {
              if (liveSnapshot?.text) {
                finalizeBufferedDictationText(liveSnapshot.text)
                transitionMic({
                  type: 'TRANSCRIPTION_INJECTED'
                })
                setStatus('Transcript injected. Press Enter to run.')
                focusTerminal()
                return
              }

              transitionMic({
                type: 'RESET_TO_REST'
              })
              setStatus(
                shouldResumeAuto ? 'Auto listening is on. No speech detected.' : 'No speech detected.',
                'default'
              )
              focusTerminal()
              return
            }

            transitionMic({
              type: 'TRANSCRIBING_STARTED'
            })

            const transcript = await api.transcribeAudio({
              audioBuffer: await blob.arrayBuffer(),
              mimeType: blob.type || mimeType
            })
            const injectedText = normalizeDictationText(transcript || liveSnapshot?.text)

            if (!injectedText) {
              transitionMic({
                type: 'TRANSCRIPTION_EMPTY'
              })
              setStatus(
                shouldResumeAuto ? 'Auto listening is on. No speech detected.' : 'No speech detected.',
                'default'
              )
              focusTerminal()
              return
            }

            if (captureSource === MIC_MODES.AUTO) {
              api.writeToPty(injectedText)
            } else {
              finalizeBufferedDictationText(injectedText)
            }

            if (shouldAutoSubmit) {
              api.writeToPty('\r')
            }

            transitionMic({
              type: 'TRANSCRIPTION_INJECTED'
            })

            if (shouldResumeAuto) {
              setStatus(
                shouldAutoSubmit
                  ? 'Transcript sent. Auto listening stays on.'
                  : 'Transcript injected. Auto listening stays on.'
              )
            }

            focusTerminal()
          } catch (error) {
            transitionMic({
              type: 'RESET_TO_REST'
            })
            setStatus(error.message, 'error')
          }
        },
        { once: true }
      )

      recorder.start()

      if (supportsManualLiveDictation(source)) {
        startLiveDictation({ source }).catch((error) => {
          logRuntime('dictation.live_start_failed', {
            source,
            message: error instanceof Error ? error.message : String(error)
          })
          setStatus(
            'Live preview is unavailable here. The final transcript will appear after capture stops.',
            'default',
            {
              durationMs: 3400,
              persistDuringBusy: true
            }
          )
        })
      }

      transitionMic({
        type: 'RECORDING_STARTED',
        source
      })
      logRuntime('mic.recording_started', {
        source,
        keepAutoArmed
      })
      clearStatus({ preserveErrors: false })

      if (source === MIC_MODES.HOLD && pendingHoldStop) {
        pendingHoldStop = false
        stopRecording({ reason: 'hold-release' })
      }

      focusTerminal()
    } catch (error) {
      transitionMic({
        type: 'RESET_TO_REST'
      })
      setStatus(error.message, 'error')
      throw error
    } finally {
      isStartingRecording = false
      renderUi()
    }
  }

  function stopRecording({ reason = 'manual-stop', keepAutoArmed = false } = {}) {
    if (!isRecording() || micState.phase === MIC_PHASES.STOPPING) {
      activePointerId = null
      renderUi()
      return false
    }

    if (currentCapture) {
      currentCapture.keepAutoArmed = keepAutoArmed
    }

    if (reason === 'mode-change' || reason === 'auto-disabled') {
      clearStatus({ preserveErrors: false })
    }

    transitionMic({
      type: 'RECORDING_STOPPING'
    })
    logRuntime('mic.recording_stopping', {
      reason,
      keepAutoArmed
    })
    mediaRecorder.stop()
    focusTerminal()
    return true
  }

  function resizeTerminal() {
    fitAddon.fit()
    api.resizePty({ cols: terminal.cols, rows: terminal.rows })
  }

  function enqueueSpeech(payload) {
    if (!payload?.audioBase64) {
      return
    }

    playbackQueue.push(payload)

    if (!isPlayingAudio) {
      isPlayingAudio = true
      transitionMic({
        type: 'PLAYBACK_STARTED'
      })
      playNextSpeech()
    }
  }

  async function playNextSpeech() {
    if (!playbackQueue.length) {
      isPlayingAudio = false
      playbackQuietUntil = performance.now() + PLAYBACK_COOLDOWN_MS
      transitionMic({
        type: 'PLAYBACK_FINISHED'
      })
      logRuntime('speech.playback_queue_drained', {})
      return
    }

    const payload = playbackQueue.shift()

    activeReplyPlaybackId = payload.id || ''
    renderReplyHistory()

    const bytes = base64ToUint8Array(payload.audioBase64)
    const blob = new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' })
    const objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    let finished = false

    const finalize = (errorMessage) => {
      if (finished) {
        return
      }

      finished = true
      URL.revokeObjectURL(objectUrl)
      activeReplyPlaybackId = ''
      renderReplyHistory()
      logRuntime('speech.playback_finished', {
        id: payload.id || '',
        errorMessage: errorMessage || ''
      })

      if (errorMessage) {
        setStatus(errorMessage, 'error')
      }

      playNextSpeech()
    }

    audio.addEventListener(
      'ended',
      () => finalize(),
      { once: true }
    )

    audio.addEventListener(
      'error',
      () => finalize('Audio playback failed.'),
      { once: true }
    )

    try {
      logRuntime('speech.playback_started', {
        id: payload.id || '',
        provider: payload.provider || '',
        text: payload.text || ''
      })
      await audio.play()
    } catch (error) {
      finalize(error.message)
    }
  }

  function setStatus(message, tone = 'default', options = {}) {
    if (!message) {
      clearStatus({ preserveErrors: false })
      return
    }

    clearStatusTimer()

    const sticky = options.sticky ?? tone === 'error'
    const durationMs = options.durationMs ?? (sticky ? 0 : STATUS_NOTICE_MS)

    statusOverride = {
      message,
      tone,
      sticky,
      persistDuringBusy: Boolean(options.persistDuringBusy),
      expiresAt: durationMs ? performance.now() + durationMs : 0
    }

    if (!sticky && durationMs > 0) {
      statusOverrideTimer = window.setTimeout(() => {
        if (statusOverride?.expiresAt && statusOverride.expiresAt <= performance.now()) {
          statusOverride = null
          renderStatus()
        }
      }, durationMs + 20)
    }

    renderStatus()
  }

  function clearStatus({ preserveErrors = true } = {}) {
    if (preserveErrors && statusOverride?.tone === 'error') {
      renderStatus()
      return
    }

    clearStatusTimer()
    statusOverride = null
    renderStatus()
  }

  function clearStatusTimer() {
    if (!statusOverrideTimer) {
      return
    }

    window.clearTimeout(statusOverrideTimer)
    statusOverrideTimer = 0
  }

  async function pasteClipboardText() {
    const text = api.readClipboardText()

    if (!text) {
      throw new Error('Clipboard does not contain text.')
    }

    logRuntime('clipboard.paste_requested', {
      text
    })
    writePastedText(text)
  }

  function writePastedText(text) {
    api.writeToPty(normalizePastedText(text))
    logRuntime('clipboard.pasted', {
      text
    })
    setStatus('Pasted text from clipboard.')
    focusTerminal()
  }

  function initializeUi() {
    api
      .getRuntimeInfo()
      .then((info) => {
        logRuntime('renderer.runtime_info', info)
      })
      .catch(() => {})

    if (!runtimeSupport.capture) {
      setStatus('Microphone capture is not available in this Electron runtime.', 'error')
    }

    renderUi()
    renderMeterIdle()
  }

  function renderUi() {
    const viewModel = getMicViewModel(micState)
    const modeDetail = getModeDetailText(viewModel)
    const micDisabled =
      !runtimeSupport.capture ||
      isStartingRecording ||
      micState.phase === MIC_PHASES.STOPPING ||
      micState.phase === MIC_PHASES.TRANSCRIBING

    controlPanel.dataset.mode = micState.mode
    controlPanel.dataset.phase = micState.phase
    controlPanel.dataset.autoStrategy = micState.autoStrategy
    controlPanel.dataset.busy = String(isBusyMicPhase(micState.phase) || isStartingRecording)

    modeButtons.forEach((button) => {
      const isSelected = button.dataset.mode === micState.mode
      const isAutoButton = button.dataset.mode === MIC_MODES.AUTO

      button.dataset.selected = String(isSelected)
      button.disabled =
        !runtimeSupport.capture ||
        isStartingRecording ||
        viewModel.modeButtonsDisabled ||
        (isAutoButton && !supportsAutoMode())
      button.dataset.supported = String(!isAutoButton || supportsAutoMode())
      button.title =
        isAutoButton && !supportsAutoMode()
          ? 'Auto mode needs microphone capture and audio monitoring in this runtime.'
          : ''
    })

    speakerButton.disabled = isPreviewRequestPending
    micButton.disabled = micDisabled
    micButton.dataset.state = viewModel.buttonVisualState
    micButton.setAttribute('aria-label', viewModel.buttonLabel)
    micButton.setAttribute(
      'aria-pressed',
      String(
        micState.phase === MIC_PHASES.RECORDING ||
          (micState.mode === MIC_MODES.AUTO && micState.autoEnabled)
      )
    )

    meterElement.dataset.active = String(Boolean(analyser && viewModel.shouldShowMeter))
    modeDetailElement.textContent = modeDetail
    modeDetailElement.dataset.tone =
      micState.mode === MIC_MODES.AUTO && !supportsAutoMode() ? 'muted' : 'default'

    renderStatus()
    renderReplyHistory()
  }

  function renderStatus() {
    const viewModel = getMicViewModel(micState)
    const override = getActiveStatusOverride()
    const shouldUseOverride =
      Boolean(override) &&
      (override.tone === 'error' || override.persistDuringBusy || !isBusyUiPhase())
    const status = shouldUseOverride
      ? override
      : {
          message: viewModel.statusText,
          tone: 'default'
        }

    statusElement.textContent = status.message
    statusElement.dataset.tone = status.tone
  }

  function getActiveStatusOverride() {
    if (!statusOverride) {
      return null
    }

    if (!statusOverride.sticky && statusOverride.expiresAt <= performance.now()) {
      statusOverride = null
      return null
    }

    return statusOverride
  }

  function getModeDetailText(viewModel) {
    if (!runtimeSupport.capture) {
      return 'Mic capture is unavailable here, so dictation controls are disabled.'
    }

    if (micState.mode === MIC_MODES.AUTO && !supportsAutoMode()) {
      return 'Always-on listening is unavailable because this runtime cannot monitor mic audio.'
    }

    return viewModel.modeDescription
  }

  function setMicMode(nextMode) {
    if (
      !Object.values(MIC_MODES).includes(nextMode) ||
      nextMode === micState.mode ||
      isStartingRecording
    ) {
      renderUi()
      return
    }

    if (nextMode === MIC_MODES.AUTO && !supportsAutoMode()) {
      setStatus(
        'Always-on listening is unavailable in this runtime.',
        'default',
        { durationMs: 3200 }
      )
      renderUi()
      return
    }

    if (micState.mode === MIC_MODES.AUTO && micState.autoEnabled && nextMode !== MIC_MODES.AUTO) {
      disarmAutoRuntime({ keepTypedText: true })
    }

    if (isRecording()) {
      stopRecording({ reason: 'mode-change' })
    }

    activePointerId = null
    transitionMic({
      type: 'SET_MODE',
      mode: nextMode
    })
    logRuntime('mic.mode_changed', {
      mode: nextMode
    })
    clearStatus({ preserveErrors: false })
  }

  async function enableAutoListening() {
    if (!supportsAutoMode()) {
      setStatus('Always-on listening is unavailable in this runtime.')
      return
    }

    clearStatus({ preserveErrors: false })
    await ensureMicrophoneReady()
    resetAutoTracking()
    transitionMic({
      type: 'AUTO_ARM'
    })
    transitionMic({
      type: 'AUTO_STRATEGY_SET',
      strategy: AUTO_STRATEGIES.CAPTURE
    })
    logRuntime('mic.auto_enabled', {
      strategy: AUTO_STRATEGIES.CAPTURE
    })
  }

  function disableAutoListening() {
    disarmAutoRuntime({ keepTypedText: true })
    resetAutoTracking()
    transitionMic({
      type: 'AUTO_DISARM'
    })
    logRuntime('mic.auto_disabled', {})

    if (isRecording()) {
      stopRecording({ reason: 'auto-disabled' })
      return
    }

    clearStatus({ preserveErrors: false })
  }

  function disarmAutoRuntime({ keepTypedText = true } = {}) {
    clearLiveRecognitionRestart()

    if (speechRecognition || micState.autoStrategy === AUTO_STRATEGIES.LIVE) {
      stopLiveDictation({ keepTypedText })
    }
  }

  async function ensureMicrophoneReady() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is not available in this Electron runtime.')
    }

    if (!mediaStream) {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
    }

    if (!audioContext && AudioContextClass) {
      audioContext = new AudioContextClass()
      sourceNode = audioContext.createMediaStreamSource(mediaStream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.68
      sourceNode.connect(analyser)
      frequencyData = new Uint8Array(analyser.frequencyBinCount)
      timeDomainData = new Uint8Array(analyser.fftSize)
    }

    if (audioContext?.state === 'suspended') {
      await audioContext.resume()
    }

    if (analyser && !meterAnimationFrame) {
      meterAnimationFrame = window.requestAnimationFrame(tickMeter)
    }
  }

  function tickMeter() {
    if (analyser && frequencyData && timeDomainData) {
      analyser.getByteFrequencyData(frequencyData)
      analyser.getByteTimeDomainData(timeDomainData)
      const level = getSignalLevel(timeDomainData)

      if (shouldShowLiveMeter()) {
        renderMeter(frequencyData, level)
      } else {
        renderMeterIdle()
      }

      processAutoListening(level)
    } else {
      renderMeterIdle()
    }

    meterAnimationFrame = window.requestAnimationFrame(tickMeter)
  }

  function renderMeter(data, level) {
    const binsPerBar = Math.max(1, Math.floor(data.length / meterBars.length))

    meterBars.forEach((bar, index) => {
      const start = index * binsPerBar
      const end = Math.min(data.length, start + binsPerBar)
      let total = 0
      let count = 0

      for (let cursor = start; cursor < end; cursor += 1) {
        total += data[cursor]
        count += 1
      }

      const average = count ? total / count / 255 : 0
      const scale = clamp(Math.max(0.08, average * 1.35 + level * 0.95), 0.08, 1)

      bar.style.setProperty('--bar-scale', scale.toFixed(3))
      bar.dataset.active = String(scale > 0.2)
    })
  }

  function renderMeterIdle() {
    meterBars.forEach((bar, index) => {
      const restingScale = 0.1 + ((index % 4) * 0.015)
      bar.style.setProperty('--bar-scale', restingScale.toFixed(3))
      bar.dataset.active = 'false'
    })
  }

  function processAutoListening(level) {
    if (
      micState.mode !== MIC_MODES.AUTO ||
      !micState.autoEnabled ||
      micState.phase === MIC_PHASES.TRANSCRIBING ||
      isStartingRecording
    ) {
      voiceCandidateSince = 0
      return
    }

    const now = performance.now()
    const { startThreshold, continueThreshold } = getAutoGateThresholds()

    if (shouldUseLiveDictation()) {
      maybeFallbackFromLiveDictation(level, now)

      if (hasRecentLiveDictationActivity(now)) {
        voiceCandidateSince = 0
        return
      }
    }

    if (isPlayingAudio || now < playbackQuietUntil) {
      voiceCandidateSince = 0
      return
    }

    if (!isRecording()) {
      updateAutoNoiseFloor(level)
    }

    if (isRecording()) {
      if (level >= continueThreshold) {
        lastVoiceAt = now
      }

      if (
        !isStartingRecording &&
        now - lastVoiceAt >= AUTO_STOP_SILENCE_MS &&
        now - (currentCapture?.startedAt || now) >= MIN_RECORDING_MS
      ) {
        stopRecording({
          reason: 'auto-silence',
          keepAutoArmed: true
        })
      }

      return
    }

    if (!supportsAutoCapture()) {
      voiceCandidateSince = 0
      return
    }

    if (level >= startThreshold) {
      if (!voiceCandidateSince) {
        voiceCandidateSince = now
      }

      if (now - voiceCandidateSince >= AUTO_START_HOLD_MS) {
        voiceCandidateSince = 0
        startRecording({
          source: MIC_MODES.AUTO,
          keepAutoArmed: true
        }).catch((error) => {
          setStatus(error.message, 'error')
        })
      }

      return
    }

    voiceCandidateSince = 0
  }

  function updateAutoNoiseFloor(level) {
    autoNoiseFloor =
      autoNoiseFloor * (1 - AUTO_NOISE_FLOOR_ALPHA) + level * AUTO_NOISE_FLOOR_ALPHA
  }

  function getAutoGateThresholds() {
    return {
      startThreshold: Math.max(AUTO_MIN_START_THRESHOLD, autoNoiseFloor + AUTO_START_MARGIN),
      continueThreshold: Math.max(
        AUTO_MIN_CONTINUE_THRESHOLD,
        autoNoiseFloor + AUTO_CONTINUE_MARGIN
      )
    }
  }

  function isRecording() {
    return Boolean(mediaRecorder && mediaRecorder.state === 'recording')
  }

  function supportsAutoMode() {
    return runtimeSupport.capture && runtimeSupport.meter
  }

  function supportsAutoCapture() {
    return Boolean(analyser && timeDomainData && frequencyData)
  }

  function shouldUseLiveDictation() {
    return Boolean(
      runtimeSupport.liveDictation &&
        micState.mode === MIC_MODES.AUTO &&
        micState.autoEnabled &&
        micState.autoStrategy === AUTO_STRATEGIES.LIVE
    )
  }

  function supportsManualLiveDictation(source) {
    return Boolean(runtimeSupport.liveDictation && source !== MIC_MODES.AUTO)
  }

  async function startLiveDictation({ source = MIC_MODES.AUTO } = {}) {
    if (
      liveDictationSession ||
      speechRecognition ||
      (!shouldUseLiveDictation() && !supportsManualLiveDictation(source))
    ) {
      return
    }

    const recognition = new SpeechRecognitionClass()
    const session = createLiveDictationSession({
      source,
      recognition
    })

    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = navigator.language || 'en-US'

    liveDictationSession = session
    speechRecognition = recognition

    recognition.addEventListener('result', (event) => {
      handleLiveDictationResult(event, session)
    })
    recognition.addEventListener('error', (event) => {
      handleLiveDictationError(event, session)

      if (event.error === 'aborted' || event.error === 'no-speech') {
        return
      }

      if (source !== MIC_MODES.AUTO) {
        return
      }

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        switchAutoModeToCapture('Live dictation is unavailable here. Using auto capture fallback.')
        return
      }

      switchAutoModeToCapture(`Live dictation failed: ${event.error}. Using auto capture fallback.`)
    })
    recognition.addEventListener('end', () => {
      handleLiveDictationEnd(session)
    })
    renderUi()
    logRuntime('dictation.live_started', {
      source
    })

    try {
      recognition.start()
    } catch (error) {
      if (speechRecognition === recognition && liveDictationSession === session) {
        speechRecognition = null
        liveDictationSession = null
      }

      session.resolveStopped(getLiveDictationSnapshot())
      renderUi()
      throw error
    }
  }

  function stopLiveDictation({ keepTypedText = true } = {}) {
    clearLiveRecognitionRestart()

    const session = liveDictationSession

    if (keepTypedText) {
      commitVisibleInterimDictation()
    } else {
      clearBufferedDictationText()
    }

    if (!session) {
      renderUi()
      return Promise.resolve(getLiveDictationSnapshot())
    }

    session.stopRequested = true

    if (speechRecognition === session.recognition) {
      speechRecognition = null
    }

    try {
      session.recognition.stop()
    } catch (_error) {
      // Chromium can throw if stop is called during teardown.
    }

    logRuntime('dictation.live_stopping', {
      source: session.source,
      keepTypedText
    })
    renderUi()
    return waitForLiveDictationToStop(session)
  }

  function handleLiveDictationResult(event, session) {
    if (liveDictationSession !== session) {
      return
    }

    if (session.source === MIC_MODES.AUTO && (!micState.autoEnabled || micState.mode !== MIC_MODES.AUTO)) {
      return
    }

    lastLiveResultAt = performance.now()
    liveFallbackVoiceSince = 0
    let nextInterimText = ''
    let nextBuffer = dictationBuffer

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = normalizeDictationText(result[0]?.transcript)

      if (!transcript) {
        continue
      }

      if (result.isFinal) {
        const cleared = clearInterimDictation(nextBuffer)

        nextBuffer = cleared.buffer
        writeAppTextToPty(cleared.eraseText)

        const appended = appendCommittedDictation(nextBuffer, transcript)

        nextBuffer = appended.buffer
        writeAppTextToPty(appended.insertText)
      } else {
        nextInterimText = appendWords(nextInterimText, transcript)
      }
    }

    const replaced = replaceInterimDictation(nextBuffer, nextInterimText)

    dictationBuffer = replaced.buffer
    writeAppTextToPty(replaced.eraseText)
    writeAppTextToPty(replaced.insertText)
    logRuntime('dictation.live_result', {
      source: session.source,
      interimText: nextInterimText,
      committedText: normalizeDictationText(nextBuffer.committedText)
    })
    renderUi()
  }

  function handleLiveDictationError(event, session) {
    logRuntime('dictation.live_error', {
      source: session.source,
      error: event.error || 'unknown'
    })

    if (
      session.source !== MIC_MODES.AUTO &&
      event.error !== 'aborted' &&
      event.error !== 'no-speech'
    ) {
      setStatus(
        'Live preview stopped. The final transcript will be injected when capture finishes.',
        'default',
        {
          durationMs: 3200,
          persistDuringBusy: true
        }
      )
    }
  }

  function handleLiveDictationEnd(session) {
    const shouldRestart =
      liveDictationSession === session &&
      session.source === MIC_MODES.AUTO &&
      shouldUseLiveDictation() &&
      !session.stopRequested

    commitVisibleInterimDictation()

    if (speechRecognition === session.recognition) {
      speechRecognition = null
    }

    if (liveDictationSession === session && !shouldRestart) {
      liveDictationSession = null
    }

    const snapshot = getLiveDictationSnapshot()
    session.resolveStopped(snapshot)
    renderUi()
    logRuntime('dictation.live_ended', {
      source: session.source,
      restart: shouldRestart,
      text: snapshot.text
    })

    if (!shouldRestart) {
      return
    }

    clearLiveRecognitionRestart()
    liveRecognitionRestartTimer = window.setTimeout(() => {
      liveRecognitionRestartTimer = 0
      startLiveDictation({ source: session.source }).catch((error) => {
        setStatus(error.message, 'error')
      })
    }, 220)
  }

  function clearVisibleInterimDictation() {
    const cleared = clearInterimDictation(dictationBuffer)

    dictationBuffer = cleared.buffer
    writeAppTextToPty(cleared.eraseText)
  }

  function commitVisibleInterimDictation() {
    const committed = commitInterimDictation(dictationBuffer)

    dictationBuffer = committed.buffer
  }

  function clearLiveRecognitionRestart() {
    if (!liveRecognitionRestartTimer) {
      return
    }

    window.clearTimeout(liveRecognitionRestartTimer)
    liveRecognitionRestartTimer = 0
  }

  function handleManualTerminalInput(data) {
    if (micState.phase === MIC_PHASES.INJECTED && data) {
      transitionMic({
        type: 'CLEAR_INJECTED'
      })
    }

    if (!data) {
      return
    }

    if (
      liveDictationSession &&
      liveDictationSession.source !== MIC_MODES.AUTO &&
      data !== '\r'
    ) {
      const consumed = consumeTerminalInput(dictationBuffer, data)

      dictationBuffer = consumed.buffer
      writeAppTextToPty(consumed.eraseText)
      return
    }

    if (!micState.autoEnabled || micState.mode !== MIC_MODES.AUTO) {
      return
    }

    const consumed = consumeTerminalInput(dictationBuffer, data)

    dictationBuffer = consumed.buffer
    writeAppTextToPty(consumed.eraseText)
  }

  function shouldShowLiveMeter() {
    if (!analyser) {
      return false
    }

    return getMicViewModel(micState).shouldShowMeter
  }

  function maybeFallbackFromLiveDictation(level, now = performance.now()) {
    if (!shouldUseLiveDictation()) {
      liveFallbackVoiceSince = 0
      return
    }

    if (level < getAutoGateThresholds().startThreshold) {
      liveFallbackVoiceSince = 0
      return
    }

    if (!liveFallbackVoiceSince) {
      liveFallbackVoiceSince = now
    }

    if (now - liveFallbackVoiceSince < LIVE_DICTATION_FALLBACK_MS) {
      return
    }

    if (hasRecentLiveDictationActivity(now)) {
      return
    }

    switchAutoModeToCapture('Live dictation was not receiving speech. Using auto capture fallback.')
  }

  function hasRecentLiveDictationActivity(now = performance.now()) {
    if (dictationBuffer.interimValue) {
      return true
    }

    return Boolean(lastLiveResultAt && now - lastLiveResultAt < LIVE_RESULT_GRACE_MS)
  }

  function switchAutoModeToCapture(message) {
    if (micState.autoStrategy === AUTO_STRATEGIES.CAPTURE) {
      if (message) {
        setStatus(message)
      }
      return
    }

    liveFallbackVoiceSince = 0
    clearLiveRecognitionRestart()

    if (speechRecognition) {
      stopLiveDictation({ keepTypedText: true })
    }

    transitionMic({
      type: 'AUTO_STRATEGY_SET',
      strategy: AUTO_STRATEGIES.CAPTURE
    })
    setStatus(message || getMicViewModel(micState).statusText, 'default', {
      durationMs: 3200,
      persistDuringBusy: true
    })
  }

  async function copyTerminalSelection() {
    const text = terminal.getSelection()

    if (!text) {
      return
    }

    api.writeClipboardText(text)
    logRuntime('clipboard.copied', {
      text
    })
    setStatus('Copied selection to clipboard.')
    focusTerminal()
  }

  function transitionMic(event) {
    micState = transitionMicState(micState, event)
    renderUi()
  }

  function releaseMicPointerCapture(pointerId = activePointerId) {
    if (pointerId === null || !micButton.hasPointerCapture(pointerId)) {
      return
    }

    try {
      micButton.releasePointerCapture(pointerId)
    } catch (_error) {
      // Chromium can throw when capture is already gone.
    }
  }

  function resetAutoTracking() {
    voiceCandidateSince = 0
    lastVoiceAt = 0
    liveFallbackVoiceSince = 0
    lastLiveResultAt = 0
    autoNoiseFloor = AUTO_MIN_CONTINUE_THRESHOLD * 0.5
  }

  function isAutoArmed() {
    return micState.mode === MIC_MODES.AUTO && micState.autoEnabled
  }

  function isBusyMicPhase(phase) {
    return BUSY_PHASES.has(phase)
  }

  function isBusyUiPhase() {
    return isStartingRecording || isBusyMicPhase(micState.phase) || micState.phase === MIC_PHASES.PLAYING
  }

  function writeAppTextToPty(text) {
    if (!text) {
      return
    }

    api.writeToPty(text)
  }

  function focusTerminal() {
    window.requestAnimationFrame(() => {
      terminal.focus()
    })
  }

  function logRuntime(type, payload = {}) {
    if (!api.logRuntimeEvent) {
      return
    }

    api.logRuntimeEvent({
      type,
      payload
    })
  }

  function createLiveDictationSession({ source, recognition }) {
    let resolveStopped

    const stopPromise = new Promise((resolve) => {
      resolveStopped = resolve
    })

    return {
      source,
      recognition,
      stopRequested: false,
      stopPromise,
      resolveStopped
    }
  }

  function waitForLiveDictationToStop(session) {
    return Promise.race([
      session.stopPromise,
      new Promise((resolve) => {
        window.setTimeout(() => {
          resolve(getLiveDictationSnapshot())
        }, LIVE_STOP_WAIT_MS)
      })
    ])
  }

  function getLiveDictationSnapshot() {
    return {
      text: normalizeDictationText(getVisibleDictationText())
    }
  }

  function getVisibleDictationText() {
    return `${dictationBuffer.committedText}${getRenderedInterimText(dictationBuffer)}`
  }

  function clearBufferedDictationText() {
    const visibleText = getVisibleDictationText()

    if (visibleText) {
      writeAppTextToPty('\u007f'.repeat(visibleText.length))
    }

    dictationBuffer = createDictationBuffer()
  }

  function finalizeBufferedDictationText(text) {
    const normalizedText = normalizeDictationText(text)
    const currentText = normalizeDictationText(getVisibleDictationText())

    if (!normalizedText) {
      dictationBuffer = createDictationBuffer()
      return
    }

    if (currentText && currentText === normalizedText) {
      commitVisibleInterimDictation()
      dictationBuffer = createDictationBuffer()
      return
    }

    clearBufferedDictationText()
    writeAppTextToPty(normalizedText)
    dictationBuffer = createDictationBuffer()
  }

  function getSignalLevel(samples) {
    let sumSquares = 0

    for (const sample of samples) {
      const normalized = (sample - 128) / 128
      sumSquares += normalized * normalized
    }

    return Math.sqrt(sumSquares / samples.length)
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function pickRecorderOptions() {
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ]

    for (const mimeType of mimeTypes) {
      if (window.MediaRecorder?.isTypeSupported?.(mimeType)) {
        return { mimeType }
      }
    }

    return undefined
  }

  function normalizePastedText(text) {
    return String(text || '').replace(/\r\n/g, '\n')
  }

  function base64ToUint8Array(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  }

  function registerReplyMessage(payload) {
    const text = String(payload?.text || '').trim()

    if (!text) {
      return
    }

    const id = String(payload?.id || `reply-${Date.now()}-${replyMessages.length}`)
    const existing = replyMessages.find((message) => message.id === id)

    if (existing) {
      existing.text = text
    } else {
      replyMessages.unshift({
        id,
        text,
        audioBase64: '',
        mimeType: '',
        provider: '',
        isLoadingAudio: false
      })
    }

    trimReplyHistory()
    renderReplyHistory()
  }

  function registerReplyAudio(payload) {
    const text = String(payload?.text || '').trim()

    if (!text) {
      return
    }

    const id = String(payload?.id || `reply-${Date.now()}-${replyMessages.length}`)
    let message = replyMessages.find((entry) => entry.id === id)

    if (!message) {
      registerReplyMessage({ id, text })
      message = replyMessages.find((entry) => entry.id === id)
    }

    if (!message) {
      return
    }

    message.text = text
    message.audioBase64 = payload.audioBase64 || message.audioBase64
    message.mimeType = payload.mimeType || message.mimeType || 'audio/mpeg'
    message.provider = payload.provider || message.provider
    renderReplyHistory()
  }

  function trimReplyHistory() {
    if (replyMessages.length > REPLY_HISTORY_LIMIT) {
      replyMessages.length = REPLY_HISTORY_LIMIT
    }
  }

  function renderReplyHistory() {
    if (!replyHistoryElement) {
      return
    }

    replyHistoryElement.hidden = replyMessages.length === 0
    replyHistoryElement.replaceChildren()

    for (const message of replyMessages) {
      const item = document.createElement('div')
      item.className = 'replyItem'

      const text = document.createElement('div')
      text.className = 'replyText'
      text.textContent = message.text

      const button = document.createElement('button')
      button.className = 'replySpeakButton'
      button.type = 'button'
      button.disabled = message.isLoadingAudio
      button.dataset.active = String(activeReplyPlaybackId === message.id)
      button.setAttribute('aria-label', `Play reply: ${message.text.slice(0, 80)}`)
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 10.5V13.5H8.5L13 18V6L8.5 10.5H5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9C17.333 10.167 18 11.5 18 13C18 14.5 17.333 15.833 16 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      button.addEventListener('click', () => {
        playReplyMessage(message.id).catch((error) => {
          setStatus(error.message, 'error')
        })
      })

      item.append(text, button)
      replyHistoryElement.append(item)
    }
  }

  async function playReplyMessage(messageId) {
    const message = replyMessages.find((entry) => entry.id === messageId)

    if (!message || message.isLoadingAudio) {
      return
    }

    try {
      message.isLoadingAudio = !message.audioBase64
      renderReplyHistory()

      if (!message.audioBase64) {
        const payload = await api.previewSpeech({
          text: message.text
        })

        if (!payload.audioBase64) {
          throw new Error('The reply TTS returned no audio.')
        }

        registerReplyAudio({
          id: message.id,
          text: message.text,
          audioBase64: payload.audioBase64,
          mimeType: payload.mimeType,
          provider: payload.provider
        })
      }

      enqueueSpeech({
        id: message.id,
        text: message.text,
        audioBase64: message.audioBase64,
        mimeType: message.mimeType || 'audio/mpeg',
        provider: message.provider || ''
      })
    } finally {
      message.isLoadingAudio = false
      renderReplyHistory()
      focusTerminal()
    }
  }

  function debounce(fn, delay) {
    let timeoutId = null

    return (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        fn(...args)
      }, delay)
    }
  }
})()
