(function bootstrapVoiceControlsUi(root) {
  const DEFAULT_MIC_MODES = {
    HOLD: 'hold',
    TOGGLE: 'toggle',
    AUTO: 'auto'
  }

  function formatModeLabel(mode, modes = DEFAULT_MIC_MODES) {
    switch (mode) {
      case modes.HOLD:
        return 'PTT'

      case modes.AUTO:
        return 'Auto'

      case modes.TOGGLE:
      default:
        return 'Click'
    }
  }

  function getModeButtonLabel(mode, autoModeSupported, modes = DEFAULT_MIC_MODES) {
    switch (mode) {
      case modes.HOLD:
        return 'PTT mode. Hold the mic button to talk, then release to inject the transcript.'

      case modes.AUTO:
        return autoModeSupported
          ? 'Auto mode. Leave listening on and text will inject after you speak and pause.'
          : 'Auto mode is unavailable here because live microphone monitoring is not available.'

      case modes.TOGGLE:
      default:
        return 'Click mode. Click once to talk, then click again or press Enter to stop.'
    }
  }

  function renderVoiceControlsView({
    controlPanel,
    modeButtons,
    speakerButton,
    speechToggleButton,
    micButton,
    drawerToggleButton,
    meterElement,
    modeDetailElement,
    micState,
    runtimeSupport,
    isStartingRecording,
    viewModel,
    autoModeSupported,
    hasAnalyser,
    isAutoReplySpeechEnabled
  }) {
    const micDisabled =
      !runtimeSupport.capture ||
      isStartingRecording ||
      micState.phase === 'stopping' ||
      micState.phase === 'transcribing'

    controlPanel.dataset.mode = micState.mode
    controlPanel.dataset.phase = micState.phase
    controlPanel.dataset.autoStrategy = micState.autoStrategy
    controlPanel.dataset.busy = String(
      viewModel.modeButtonsDisabled || isStartingRecording || micState.phase === 'transcribing'
    )

    modeButtons.forEach((button) => {
      const isSelected = button.dataset.mode === micState.mode
      const isAutoButton = button.dataset.mode === DEFAULT_MIC_MODES.AUTO
      const modeButtonLabel = getModeButtonLabel(button.dataset.mode, autoModeSupported)

      button.dataset.selected = String(isSelected)
      button.disabled =
        !runtimeSupport.capture ||
        isStartingRecording ||
        viewModel.modeButtonsDisabled ||
        (isAutoButton && !autoModeSupported)
      button.dataset.supported = String(!isAutoButton || autoModeSupported)
      button.setAttribute('aria-pressed', String(isSelected))
      button.setAttribute('aria-label', modeButtonLabel)
      button.title = modeButtonLabel
    })

    speakerButton.disabled = viewModel.isPreviewRequestPending
    speakerButton.setAttribute(
      'aria-label',
      viewModel.isPreviewRequestPending
        ? 'Generating a test voice sample'
        : 'Play a short test voice sample using the current reply voice'
    )
    speakerButton.title = viewModel.isPreviewRequestPending
      ? 'Generating a test voice sample'
      : 'Play a short test voice sample using the current reply voice'

    if (speechToggleButton) {
      speechToggleButton.dataset.active = String(isAutoReplySpeechEnabled)
      speechToggleButton.setAttribute('aria-pressed', String(isAutoReplySpeechEnabled))
      speechToggleButton.setAttribute(
        'aria-label',
        isAutoReplySpeechEnabled
          ? 'Turn off spoken assistant replies'
          : 'Turn on spoken assistant replies'
      )
      speechToggleButton.title = isAutoReplySpeechEnabled
        ? 'Turn off spoken assistant replies'
        : 'Turn on spoken assistant replies'
    }

    micButton.disabled = micDisabled
    micButton.dataset.state = viewModel.buttonVisualState
    micButton.dataset.monitoring = String(Boolean(hasAnalyser && viewModel.shouldShowMeter))
    micButton.setAttribute('aria-label', viewModel.buttonLabel)
    micButton.title = viewModel.buttonLabel
    micButton.setAttribute(
      'aria-pressed',
      String(
        micState.phase === 'recording' || (micState.mode === DEFAULT_MIC_MODES.AUTO && micState.autoEnabled)
      )
    )

    drawerToggleButton.textContent = `Voice: ${formatModeLabel(micState.mode, DEFAULT_MIC_MODES)}`
    drawerToggleButton.setAttribute(
      'aria-label',
      `${viewModel.isControlDrawerOpen ? 'Hide' : 'Show'} voice controls. Current mode: ${formatModeLabel(micState.mode, DEFAULT_MIC_MODES)}.`
    )
    drawerToggleButton.title = `${viewModel.isControlDrawerOpen ? 'Hide' : 'Show'} voice controls`

    if (meterElement) {
      meterElement.dataset.active = String(Boolean(hasAnalyser && viewModel.shouldShowMeter))
    }

    modeDetailElement.textContent = viewModel.modeDetail
    modeDetailElement.dataset.tone = viewModel.modeDetailTone
  }

  const api = {
    formatModeLabel,
    getModeButtonLabel,
    renderVoiceControlsView
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalVoiceControlsUi = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
