(function bootstrapReplyHistoryUi(root) {
  function upsertReplyMessage(replyMessages, payload) {
    const text = String(payload?.text || '').trim()

    if (!text) {
      return false
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
        isLoadingAudio: false,
        isVisible: false,
        pendingHideAfterPlayback: false
      })
    }

    return true
  }

  function attachReplyAudio(replyMessages, payload) {
    const text = String(payload?.text || '').trim()

    if (!text) {
      return false
    }

    const id = String(payload?.id || `reply-${Date.now()}-${replyMessages.length}`)
    let message = replyMessages.find((entry) => entry.id === id)

    if (!message) {
      upsertReplyMessage(replyMessages, { id, text })
      message = replyMessages.find((entry) => entry.id === id)
    }

    if (!message) {
      return false
    }

    message.text = text
    message.audioBase64 = payload.audioBase64 || message.audioBase64
    message.mimeType = payload.mimeType || message.mimeType || 'audio/mpeg'
    message.provider = payload.provider || message.provider
    return true
  }

  function trimReplyHistory(replyMessages, limit) {
    if (replyMessages.length > limit) {
      replyMessages.length = limit
    }
  }

  function shouldShowReplyHistory(replyMessages, isReplyHistoryVisible, isReplyHistoryPinned) {
    return Boolean(replyMessages.length && (isReplyHistoryVisible || isReplyHistoryPinned))
  }

  function renderReplyHistoryView({
    replyHistoryElement,
    replyHistoryToggleButton,
    replyMessages,
    shouldShow,
    activeReplyPlaybackId,
    onReplyButtonClick
  }) {
    if (!replyHistoryElement || !replyHistoryToggleButton) {
      return
    }

    replyHistoryElement.hidden = replyMessages.length === 0
    replyHistoryElement.dataset.visible = String(shouldShow)
    replyHistoryToggleButton.dataset.active = String(shouldShow)
    replyHistoryToggleButton.setAttribute('aria-pressed', String(shouldShow))
    replyHistoryToggleButton.setAttribute(
      'aria-label',
      shouldShow ? 'Hide recent reply playback controls' : 'Show recent reply playback controls'
    )
    replyHistoryToggleButton.title = shouldShow
      ? 'Hide recent reply playback controls'
      : 'Show recent reply playback controls'
    replyHistoryElement.replaceChildren()

    replyMessages.forEach((message) => {
      const item = document.createElement('div')
      item.className = 'replyItem'
      item.dataset.replyId = message.id

      const text = document.createElement('div')
      text.className = 'replyText'
      text.textContent = message.text

      const button = document.createElement('button')
      button.className = 'replySpeakButton'
      button.type = 'button'
      button.disabled = message.isLoadingAudio
      button.dataset.active = String(activeReplyPlaybackId === message.id)
      button.setAttribute(
        'aria-label',
        activeReplyPlaybackId === message.id
          ? `Stop reply: ${message.text.slice(0, 80)}`
          : `Play reply: ${message.text.slice(0, 80)}`
      )
      button.title =
        activeReplyPlaybackId === message.id
          ? 'Stop spoken reply playback'
          : 'Play this reply again'
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 10.5V13.5H8.5L13 18V6L8.5 10.5H5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9C17.333 10.167 18 11.5 18 13C18 14.5 17.333 15.833 16 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      button.addEventListener('click', () => {
        onReplyButtonClick(message)
      })
      item.append(text, button)
      replyHistoryElement.append(item)
    })
  }

  const api = {
    attachReplyAudio,
    renderReplyHistoryView,
    shouldShowReplyHistory,
    trimReplyHistory,
    upsertReplyMessage
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalReplyHistoryUi = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
