(function bootstrapMicControls(root) {
  const micStateApi =
    typeof module !== 'undefined' && module.exports
      ? require('./lib/mic-state')
      : root.WslVoiceTerminalMicState
  const { MIC_MODES, getEnterIntentForMicState } = micStateApi

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

    return (
      getEnterIntentForMicState({
        mode: micMode,
        phase: isRecording
          ? 'recording'
          : isStoppingRecording
            ? 'stopping'
            : isTranscribing
              ? 'transcribing'
              : 'idle'
      }) !== 'pass-through'
    )
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
