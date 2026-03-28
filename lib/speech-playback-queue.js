(function bootstrapSpeechPlaybackQueue(root) {
  function insertPlaybackItem(queue, payload) {
    if (!Array.isArray(queue) || !payload) {
      return queue
    }

    const item = {
      ...payload
    }

    if (item.kind === 'approval') {
      const insertIndex = queue.findIndex((entry) => entry?.kind !== 'approval')

      if (insertIndex === -1) {
        queue.push(item)
      } else {
        queue.splice(insertIndex, 0, item)
      }

      return queue
    }

    queue.push(item)
    return queue
  }

  const api = {
    insertPlaybackItem
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.WslVoiceTerminalSpeechPlaybackQueue = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
