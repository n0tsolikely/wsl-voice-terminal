(function bootstrap() {
  const api = window.terminalAPI
  const { MIC_MODES, shouldConsumeEnterForMic } = window.WslVoiceTerminalMic
  const terminalElement = document.getElementById('terminal')
  const micButton = document.getElementById('micButton')
  const speakerButton = document.getElementById('speakerButton')
  const statusElement = document.getElementById('status')
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
  const AUTO_START_THRESHOLD = 0.04
  const AUTO_CONTINUE_THRESHOLD = 0.024
  const AUTO_START_HOLD_MS = 160
  const AUTO_STOP_SILENCE_MS = 1100
  const MIN_RECORDING_MS = 350
  const PLAYBACK_COOLDOWN_MS = 450
  const LIVE_DICTATION_FALLBACK_MS = 1400

  let micMode = MIC_MODES.TOGGLE
  let mediaStream = null
  let mediaRecorder = null
  let speechRecognition = null
  let currentCapture = null
  let activePointerId = null
  let isStartingRecording = false
  let isStoppingRecording = false
  let isTranscribing = false
  let autoListenEnabled = false
  let autoModeStrategy = SpeechRecognitionClass ? 'live' : 'capture'
  let liveRecognitionRestartTimer = 0
  let liveCommittedText = ''
  let liveInterimText = ''
  let liveFallbackVoiceSince = 0
  let lastLiveResultAt = 0
  let voiceCandidateSince = 0
  let lastVoiceAt = 0
  let playbackQuietUntil = 0
  let audioContext = null
  let analyser = null
  let sourceNode = null
  let frequencyData = null
  let timeDomainData = null
  let meterAnimationFrame = 0
  const playbackQueue = []
  let isPlayingAudio = false

  terminal.loadAddon(fitAddon)
  terminal.open(terminalElement)
  fitAddon.fit()
  terminal.focus()
  terminal.attachCustomKeyEventHandler((event) => {
    if (
      event.type === 'keydown' &&
      event.key.toLowerCase() === 'v' &&
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

    if (
      shouldConsumeEnterForMic({
        eventType: event.type,
        key: event.key,
        micMode,
        isRecording: isRecording(),
        isStoppingRecording,
        isTranscribing
      })
    ) {
      event.preventDefault()
      event.stopPropagation()

      if (isRecording()) {
        stopRecording({
          reason: 'manual-enter',
          keepAutoArmed: micMode === MIC_MODES.AUTO && autoListenEnabled
        })
      } else if (isTranscribing) {
        setStatus('Transcribing...')
      } else if (isStoppingRecording) {
        setStatus('Finishing capture...')
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

  api.onSpeechAudio((payload) => {
    enqueueSpeech(payload)
  })

  api.onStatus((payload) => {
    if (payload?.message) {
      setStatus(payload.message)
    }
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
      terminal.focus()
    })
  })
  speakerButton.addEventListener('click', async () => {
    try {
      setStatus('Requesting test voice...')
      const payload = await api.previewSpeech({
        text: 'Speaker test. If you can hear this, terminal audio output is working.'
      })

      if (!payload.audioBase64) {
        throw new Error('The TTS test returned no audio.')
      }

      enqueueSpeech(payload)
      terminal.focus()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  })

  micButton.addEventListener('pointerdown', async (event) => {
    if (micMode !== MIC_MODES.HOLD) {
      return
    }

    event.preventDefault()

    if (activePointerId !== null) {
      return
    }

    activePointerId = event.pointerId
    micButton.setPointerCapture(event.pointerId)

    try {
      await startRecording({ source: MIC_MODES.HOLD })
    } catch (error) {
      activePointerId = null
      setStatus(error.message, 'error')
    }
  })

  micButton.addEventListener('pointerup', (event) => {
    if (micMode === MIC_MODES.HOLD && event.pointerId === activePointerId) {
      stopRecording({ reason: 'hold-release' })
    }
  })

  micButton.addEventListener('pointercancel', (event) => {
    if (micMode === MIC_MODES.HOLD && event.pointerId === activePointerId) {
      stopRecording({ reason: 'hold-cancel' })
    }
  })

  micButton.addEventListener('click', async (event) => {
    event.preventDefault()

    if (micMode === MIC_MODES.HOLD) {
      terminal.focus()
      return
    }

    try {
      if (micMode === MIC_MODES.TOGGLE) {
        if (isRecording()) {
          stopRecording({ reason: 'manual-click' })
        } else if (!isStartingRecording && !isTranscribing) {
          await startRecording({ source: MIC_MODES.TOGGLE })
        }
      } else if (micMode === MIC_MODES.AUTO) {
        if (autoListenEnabled) {
          disableAutoListening()
        } else if (!isTranscribing) {
          await enableAutoListening()
        }
      }
    } catch (error) {
      setStatus(error.message, 'error')
    } finally {
      terminal.focus()
    }
  })

  initializeUi()

  async function startRecording({ source, keepAutoArmed = false }) {
    if (isRecording() || isStartingRecording || isStoppingRecording || isTranscribing) {
      return
    }

    isStartingRecording = true
    updateMicButtonState()

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

      recorder.addEventListener('dataavailable', (captureEvent) => {
        if (captureEvent.data.size > 0) {
          chunks.push(captureEvent.data)
        }
      })

      recorder.addEventListener(
        'stop',
        async () => {
          const mimeType = recorder.mimeType || 'audio/webm'
          const shouldResumeAuto =
            capture.keepAutoArmed && micMode === MIC_MODES.AUTO && autoListenEnabled

          if (currentCapture === capture) {
            currentCapture = null
          }

          mediaRecorder = null
          activePointerId = null

          try {
            const blob = new Blob(chunks, { type: mimeType })

            if (blob.size === 0) {
              setStatus(shouldResumeAuto ? 'Auto listening is on.' : getIdleStatus())
              return
            }

            isTranscribing = true
            updateMicButtonState()
            setStatus('Transcribing...')

            const transcript = await api.transcribeAudio({
              audioBuffer: await blob.arrayBuffer(),
              mimeType: blob.type || mimeType
            })
            const injectedText = normalizeTranscript(transcript)

            if (!injectedText) {
              setStatus(
                shouldResumeAuto ? 'Auto listening is on. No speech detected.' : 'No speech detected.'
              )
              terminal.focus()
              return
            }

            api.writeToPty(injectedText)
            setStatus(
              shouldResumeAuto
                ? 'Transcript injected. Auto listening stays on.'
                : 'Transcript injected. Press Enter to run.'
            )
            terminal.focus()
          } catch (error) {
            setStatus(error.message, 'error')
          } finally {
            isStoppingRecording = false
            isTranscribing = false
            updateMicButtonState()
          }
        },
        { once: true }
      )

      recorder.start()
      updateMicButtonState()
      setStatus(getRecordingStatus(source))
      terminal.focus()
    } catch (error) {
      isStoppingRecording = false
      setStatus(error.message, 'error')
      updateMicButtonState()
      throw error
    } finally {
      isStartingRecording = false
      updateMicButtonState()
    }
  }

  function stopRecording({ reason = 'manual-stop', keepAutoArmed = false } = {}) {
    if (!isRecording() || isStoppingRecording) {
      activePointerId = null
      updateMicButtonState()
      return false
    }

    isStoppingRecording = true
    if (currentCapture) {
      currentCapture.keepAutoArmed = keepAutoArmed
    }

    if (reason === 'manual-enter') {
      setStatus('Finishing capture...')
    } else if (reason === 'auto-silence') {
      setStatus('Heard enough. Transcribing...')
    } else {
      setStatus('Stopping mic...')
    }

    mediaRecorder.stop()
    updateMicButtonState()
    terminal.focus()
    return true
  }

  function resizeTerminal() {
    fitAddon.fit()
    api.resizePty({ cols: terminal.cols, rows: terminal.rows })
  }

  function enqueueSpeech(payload) {
    playbackQueue.push(payload)

    if (!isPlayingAudio) {
      playNextSpeech()
    }
  }

  async function playNextSpeech() {
    if (!playbackQueue.length) {
      isPlayingAudio = false
      playbackQuietUntil = performance.now() + PLAYBACK_COOLDOWN_MS
      restoreIdleStatus()
      return
    }

    isPlayingAudio = true
    const payload = playbackQueue.shift()
    const bytes = base64ToUint8Array(payload.audioBase64)
    const blob = new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' })
    const objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    let finished = false

    setStatus('Playing response...')

    const finalize = (errorMessage) => {
      if (finished) {
        return
      }

      finished = true
      URL.revokeObjectURL(objectUrl)

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
      await audio.play()
    } catch (error) {
      finalize(error.message)
    }
  }

  function setStatus(message, tone = 'default') {
    statusElement.textContent = message
    statusElement.dataset.tone = tone
  }

  async function pasteClipboardText() {
    const text = api.readClipboardText()

    if (!text) {
      throw new Error('Clipboard does not contain text.')
    }

    writePastedText(text)
  }

  function writePastedText(text) {
    api.writeToPty(normalizePastedText(text))
    setStatus('Pasted text from clipboard.')
    terminal.focus()
  }

  function initializeUi() {
    updateModeSelection()
    updateMicButtonState()
    renderMeterIdle()
    restoreIdleStatus()
  }

  function updateModeSelection() {
    modeButtons.forEach((button) => {
      button.dataset.selected = String(button.dataset.mode === micMode)
    })
  }

  function updateMicButtonState() {
    let nextState = 'idle'

    if (isTranscribing) {
      nextState = 'transcribing'
    } else if (isStartingRecording || isStoppingRecording || isRecording()) {
      nextState = 'recording'
    } else if (micMode === MIC_MODES.AUTO && autoListenEnabled) {
      nextState = 'armed'
    }

    micButton.dataset.state = nextState
    micButton.setAttribute('aria-label', getMicButtonLabel())
  }

  function getMicButtonLabel() {
    if (micMode === MIC_MODES.HOLD) {
      return 'Hold to dictate'
    }

    if (micMode === MIC_MODES.AUTO) {
      return autoListenEnabled ? 'Turn off always-on listening' : 'Turn on always-on listening'
    }

    return isRecording() ? 'Stop dictation' : 'Start dictation'
  }

  function getIdleStatus() {
    if (micMode === MIC_MODES.HOLD) {
      return 'Hold mic to talk.'
    }

    if (micMode === MIC_MODES.AUTO) {
      return autoListenEnabled
        ? autoModeStrategy === 'live'
          ? 'Auto listening is on. Speak and text should appear as you talk.'
          : 'Auto listening is on. It will capture speech automatically.'
        : 'Click mic to arm always-on listening.'
    }

    return 'Click mic to talk. Press Enter to stop.'
  }

  function getRecordingStatus(source) {
    if (source === MIC_MODES.AUTO) {
      return 'Auto fallback capture is running...'
    }

    if (micMode === MIC_MODES.TOGGLE) {
      return 'Listening... press Enter or click mic to stop.'
    }

    return 'Recording...'
  }

  function restoreIdleStatus() {
    if (statusElement.dataset.tone === 'error') {
      return
    }

    if (isPlayingAudio) {
      setStatus('Playing response...')
      return
    }

    if (isTranscribing) {
      setStatus('Transcribing...')
      return
    }

    if (isRecording() || isStartingRecording || isStoppingRecording) {
      setStatus(getRecordingStatus(currentCapture?.source || micMode))
      return
    }

    setStatus(getIdleStatus())
  }

  function setMicMode(nextMode) {
    if (!Object.values(MIC_MODES).includes(nextMode) || nextMode === micMode) {
      return
    }

    const leavingAutoMode = micMode === MIC_MODES.AUTO && autoListenEnabled
    micMode = nextMode

    if (leavingAutoMode) {
      autoListenEnabled = false
      voiceCandidateSince = 0

      if (isRecording()) {
        stopRecording({ reason: 'mode-change' })
      }
    } else if (isRecording()) {
      stopRecording({ reason: 'mode-change' })
    }

    activePointerId = null
    updateModeSelection()
    updateMicButtonState()
    restoreIdleStatus()
  }

  async function enableAutoListening() {
    await ensureMicrophoneReady()
    autoListenEnabled = true
    autoModeStrategy = SpeechRecognitionClass ? 'live' : 'capture'
    voiceCandidateSince = 0
    lastVoiceAt = 0
    liveFallbackVoiceSince = 0
    lastLiveResultAt = performance.now()

    if (shouldUseLiveDictation()) {
      try {
        await startLiveDictation()
      } catch (_error) {
        switchAutoModeToCapture('Live dictation did not start. Using auto capture fallback.')
      }
    }

    updateMicButtonState()
    setStatus(getIdleStatus())
  }

  function disableAutoListening() {
    autoListenEnabled = false
    autoModeStrategy = SpeechRecognitionClass ? 'live' : 'capture'
    voiceCandidateSince = 0
    lastVoiceAt = 0
    liveFallbackVoiceSince = 0
    lastLiveResultAt = 0
    clearLiveRecognitionRestart()

    if (speechRecognition || autoModeStrategy === 'live') {
      stopLiveDictation({ keepTypedText: true })
    }

    if (isRecording()) {
      stopRecording({ reason: 'auto-disabled' })
      return
    }

    updateMicButtonState()
    restoreIdleStatus()
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

    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext

      if (!AudioContextClass) {
        throw new Error('Audio monitoring is not available in this Electron runtime.')
      }

      audioContext = new AudioContextClass()
      sourceNode = audioContext.createMediaStreamSource(mediaStream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.68
      sourceNode.connect(analyser)
      frequencyData = new Uint8Array(analyser.frequencyBinCount)
      timeDomainData = new Uint8Array(analyser.fftSize)
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    if (!meterAnimationFrame) {
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
    if (shouldUseLiveDictation()) {
      maybeFallbackFromLiveDictation(level)
      voiceCandidateSince = 0
      return
    }

    if (micMode !== MIC_MODES.AUTO || !autoListenEnabled || isTranscribing || isStartingRecording) {
      voiceCandidateSince = 0
      return
    }

    const now = performance.now()

    if (isPlayingAudio || now < playbackQuietUntil) {
      voiceCandidateSince = 0
      return
    }

    if (isRecording()) {
      if (level >= AUTO_CONTINUE_THRESHOLD) {
        lastVoiceAt = now
      }

      if (
        !isStoppingRecording &&
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

    if (level >= AUTO_START_THRESHOLD) {
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

  function isRecording() {
    return Boolean(mediaRecorder && mediaRecorder.state === 'recording')
  }

  function supportsLiveDictation() {
    return Boolean(SpeechRecognitionClass)
  }

  function shouldUseLiveDictation() {
    return Boolean(supportsLiveDictation() && autoListenEnabled && micMode === MIC_MODES.AUTO && autoModeStrategy === 'live')
  }

  async function startLiveDictation() {
    if (speechRecognition || !shouldUseLiveDictation()) {
      return
    }

    const recognition = new SpeechRecognitionClass()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = navigator.language || 'en-US'

    recognition.addEventListener('result', handleLiveDictationResult)
    recognition.addEventListener('error', (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') {
        return
      }

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        switchAutoModeToCapture('Live dictation is unavailable here. Using auto capture fallback.')
        return
      }

      switchAutoModeToCapture(`Live dictation failed: ${event.error}. Using auto capture fallback.`)
    })
    recognition.addEventListener('end', () => {
      const shouldRestart =
        recognition === speechRecognition && shouldUseLiveDictation()

      commitInterimDictationText()

      if (recognition === speechRecognition) {
        speechRecognition = null
      }

      updateMicButtonState()

      if (!shouldRestart) {
        restoreIdleStatus()
        return
      }

      clearLiveRecognitionRestart()
      liveRecognitionRestartTimer = window.setTimeout(() => {
        liveRecognitionRestartTimer = 0
        startLiveDictation().catch((error) => {
          setStatus(error.message, 'error')
        })
      }, 220)
    })

    speechRecognition = recognition
    updateMicButtonState()

    try {
      recognition.start()
      restoreIdleStatus()
    } catch (error) {
      if (speechRecognition === recognition) {
        speechRecognition = null
      }

      updateMicButtonState()
      throw error
    }
  }

  function stopLiveDictation({ keepTypedText = true } = {}) {
    clearLiveRecognitionRestart()

    if (keepTypedText) {
      commitInterimDictationText()
    } else {
      clearInterimDictationText()
      resetLiveDictationState()
    }

    if (!speechRecognition) {
      updateMicButtonState()
      return
    }

    const activeRecognition = speechRecognition
    speechRecognition = null

    try {
      activeRecognition.stop()
    } catch (_error) {
      // Chromium can throw if stop is called during teardown.
    }

    updateMicButtonState()
  }

  function handleLiveDictationResult(event) {
    if (!autoListenEnabled || micMode !== MIC_MODES.AUTO) {
      return
    }

    lastLiveResultAt = performance.now()
    liveFallbackVoiceSince = 0
    let nextInterimText = ''

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = normalizeTranscript(result[0]?.transcript)

      if (!transcript) {
        continue
      }

      if (result.isFinal) {
        clearInterimDictationText()
        appendCommittedDictationText(transcript)
      } else {
        nextInterimText = appendWords(nextInterimText, transcript)
      }
    }

    replaceInterimDictationText(nextInterimText)
    restoreIdleStatus()
  }

  function appendCommittedDictationText(text) {
    const chunk = formatDictationChunk(text, {
      needsLeadingSpace: Boolean(liveCommittedText)
    })

    if (!chunk) {
      return
    }

    writeAppTextToPty(chunk)
    liveCommittedText += chunk
  }

  function replaceInterimDictationText(nextText) {
    const normalized = normalizeTranscript(nextText)

    if (normalized === liveInterimText) {
      return
    }

    clearInterimDictationText()

    if (!normalized) {
      return
    }

    const chunk = formatDictationChunk(normalized, {
      needsLeadingSpace: Boolean(liveCommittedText)
    })

    if (!chunk) {
      return
    }

    writeAppTextToPty(chunk)
    liveInterimText = chunk
  }

  function clearInterimDictationText() {
    if (!liveInterimText) {
      return
    }

    writeAppTextToPty(buildBackspaceSequence(liveInterimText.length))
    liveInterimText = ''
  }

  function commitInterimDictationText() {
    if (!liveInterimText) {
      return
    }

    liveCommittedText += liveInterimText
    liveInterimText = ''
  }

  function resetLiveDictationState() {
    liveCommittedText = ''
    liveInterimText = ''
  }

  function clearLiveRecognitionRestart() {
    if (!liveRecognitionRestartTimer) {
      return
    }

    window.clearTimeout(liveRecognitionRestartTimer)
    liveRecognitionRestartTimer = 0
  }

  function writeAppTextToPty(text) {
    if (!text) {
      return
    }

    api.writeToPty(text)
  }

  function handleManualTerminalInput(data) {
    if (!data || !autoListenEnabled || micMode !== MIC_MODES.AUTO) {
      return
    }

    if (data.includes('\r') || data.includes('\n')) {
      resetLiveDictationState()
      return
    }

    if (data.includes('\u0003')) {
      clearInterimDictationText()
      resetLiveDictationState()
    }
  }

  function shouldShowLiveMeter() {
    if (isRecording() || isStartingRecording || isStoppingRecording || isTranscribing) {
      return true
    }

    return micMode === MIC_MODES.AUTO && autoListenEnabled
  }

  function maybeFallbackFromLiveDictation(level) {
    if (!shouldUseLiveDictation()) {
      liveFallbackVoiceSince = 0
      return
    }

    const now = performance.now()

    if (level < AUTO_START_THRESHOLD) {
      liveFallbackVoiceSince = 0
      return
    }

    if (!liveFallbackVoiceSince) {
      liveFallbackVoiceSince = now
    }

    if (now - liveFallbackVoiceSince < LIVE_DICTATION_FALLBACK_MS) {
      return
    }

    if (now - lastLiveResultAt < LIVE_DICTATION_FALLBACK_MS) {
      return
    }

    switchAutoModeToCapture('Live dictation was not receiving speech. Using auto capture fallback.')
  }

  function switchAutoModeToCapture(message) {
    if (autoModeStrategy === 'capture') {
      if (message) {
        setStatus(message)
      }
      return
    }

    autoModeStrategy = 'capture'
    liveFallbackVoiceSince = 0
    clearLiveRecognitionRestart()

    if (speechRecognition) {
      stopLiveDictation({ keepTypedText: true })
    }

    updateMicButtonState()
    setStatus(message || getIdleStatus())
  }

  function formatDictationChunk(text, { needsLeadingSpace = false } = {}) {
    const normalized = normalizeTranscript(text)

    if (!normalized) {
      return ''
    }

    return `${needsLeadingSpace ? ' ' : ''}${normalized}`
  }

  function appendWords(base, addition) {
    const normalizedBase = normalizeTranscript(base)
    const normalizedAddition = normalizeTranscript(addition)

    if (!normalizedAddition) {
      return normalizedBase
    }

    if (!normalizedBase) {
      return normalizedAddition
    }

    return `${normalizedBase} ${normalizedAddition}`
  }

  function buildBackspaceSequence(length) {
    return '\u007f'.repeat(length)
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
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return { mimeType }
      }
    }

    return undefined
  }

  function normalizeTranscript(text) {
    return String(text || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
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
