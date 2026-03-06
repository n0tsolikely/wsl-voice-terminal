const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, handler) {
  const listener = (_event, payload) => {
    handler(payload)
  }

  ipcRenderer.on(channel, listener)

  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('terminalAPI', {
  startPty: (dimensions) => ipcRenderer.invoke('pty:start', dimensions),
  writeToPty: (data) => ipcRenderer.send('pty:input', data),
  resizePty: (dimensions) => ipcRenderer.send('pty:resize', dimensions),
  transcribeAudio: (payload) => ipcRenderer.invoke('stt:transcribe', payload),
  previewSpeech: (payload) => ipcRenderer.invoke('speech:preview', payload),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  logRuntimeEvent: (payload) => ipcRenderer.send('runtime:log', payload),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
  onPtyData: (handler) => subscribe('pty:data', handler),
  onPtyExit: (handler) => subscribe('pty:exit', handler),
  onSpeechFinalized: (handler) => subscribe('speech:finalized', handler),
  onSpeechAudio: (handler) => subscribe('speech:audio', handler),
  onStatus: (handler) => subscribe('app:status', handler),
  onError: (handler) => subscribe('app:error', handler)
})
