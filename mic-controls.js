(function bootstrapMicControls(root) {
  const MIC_MODES = {
    HOLD: 'hold',
    TOGGLE: 'toggle',
    AUTO: 'auto'
  }

  function shouldConsumeEnterForMic({
    eventType,
    key,
    micMode,
    isRecording = false,
    isStoppingRecording = false,
    isTranscribing = false
  }) {
    if (eventType !== 'keydown' || key !== 'Enter') {
      return false
    }

    if (micMode !== MIC_MODES.TOGGLE && micMode !== MIC_MODES.AUTO) {
      return false
    }

    return Boolean(isRecording || isStoppingRecording || isTranscribing)
  }

  const api = {
    MIC_MODES,
    shouldConsumeEnterForMic
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalMic = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
