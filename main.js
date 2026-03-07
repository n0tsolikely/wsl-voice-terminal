const { spawn } = require('node:child_process')
const { app, BrowserWindow, clipboard, ipcMain, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const pty = require('node-pty')
const packageManifest = require('./package.json')
const { AppUpdater, buildUpdatePrompt } = require('./lib/app-updater')
const { LocalTtsClient } = require('./lib/local-tts-client')
const { LocalWhisperClient } = require('./lib/local-whisper-client')
const { OpenAiAudioClient, isInvalidApiKeyError } = require('./lib/openai-audio-client')
const { RuntimeLogger } = require('./lib/runtime-logger')
const { runCommand } = require('./lib/run-command')
const { TerminalSession } = require('./lib/terminal-session')
const { TTS_PROVIDERS } = require('./lib/tts-provider-selection')
const { TtsService } = require('./lib/tts-service')

configureWindowsStoragePaths()
loadDotEnv(path.join(__dirname, '.env'))

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1'
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1'
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy'
const TTS_FORMAT = 'mp3'
const TTS_PROVIDER = process.env.TTS_PROVIDER || TTS_PROVIDERS.AUTO
const LOCAL_TTS_VOICE = process.env.LOCAL_TTS_VOICE || ''
const LOCAL_WHISPER_MODEL = process.env.LOCAL_WHISPER_MODEL || 'base.en'
const LOCAL_WHISPER_DEVICE = process.env.LOCAL_WHISPER_DEVICE || 'cpu'
const LOCAL_WHISPER_COMPUTE_TYPE = process.env.LOCAL_WHISPER_COMPUTE_TYPE || 'int8'
const LOCAL_WHISPER_LANGUAGE = process.env.LOCAL_WHISPER_LANGUAGE || 'en'

let mainWindow = null
let terminalSession = null
let hasCheckedForAppUpdate = false
let activeUpdateInfo = null
let isApplyingAppUpdate = false
const statusNoticeKeys = new Set()
const runtimeLogger = new RuntimeLogger({
  baseDir: __dirname
})
const appLogger = runtimeLogger.child({
  component: 'app',
  processType: 'main'
})
const openAIClient = new OpenAiAudioClient({
  apiBase: OPENAI_API_BASE,
  apiKey: process.env.OPENAI_API_KEY || '',
  transcriptionModel: TRANSCRIPTION_MODEL,
  ttsModel: TTS_MODEL,
  ttsVoice: TTS_VOICE,
  ttsFormat: TTS_FORMAT
})
const localTtsClient = new LocalTtsClient({
  baseDir: __dirname,
  runCommand,
  voice: LOCAL_TTS_VOICE
})
const ttsService = new TtsService({
  requestedProvider: TTS_PROVIDER,
  openAiAudioClient: openAIClient,
  localTtsClient
})
const localWhisperClient = new LocalWhisperClient({
  baseDir: __dirname,
  runCommand,
  model: LOCAL_WHISPER_MODEL,
  device: LOCAL_WHISPER_DEVICE,
  computeType: LOCAL_WHISPER_COMPUTE_TYPE,
  language: LOCAL_WHISPER_LANGUAGE
})
const appUpdater = new AppUpdater({
  baseDir: __dirname,
  runCommand,
  fetchImpl: fetch,
  appVersion: packageManifest.version
})

function configureWindowsStoragePaths() {
  if (process.platform !== 'win32') {
    return
  }

  const localAppData = String(process.env.LOCALAPPDATA || '').trim()
  if (!localAppData) {
    return
  }

  const appStorageRoot = path.join(localAppData, packageManifest.name || 'wsl-voice-terminal')
  const userDataPath = path.join(appStorageRoot, 'User Data')
  const cachePath = path.join(appStorageRoot, 'Cache')

  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.mkdirSync(cachePath, { recursive: true })
    app.setPath('userData', userDataPath)
    app.setPath('sessionData', userDataPath)
    app.setPath('cache', cachePath)
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    console.warn(`[WARN] Could not configure Electron cache paths: ${message}`)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111111',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  const windowLogger = runtimeLogger.child({
    component: 'window',
    processType: 'main',
    windowId: mainWindow.id
  })
  terminalSession = new TerminalSession({
    window: mainWindow,
    ttsService,
    spawnPty: pty.spawn,
    logger: windowLogger.child({
      component: 'terminal'
    })
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.webContents.once('did-finish-load', () => {
    announceInitialSpeechMode()
    warmLocalWhisperRuntime()
  })
  windowLogger.log('window.created', {
    width: 1440,
    height: 900
  })

  mainWindow.on('closed', () => {
    terminalSession?.dispose()
    terminalSession = null
    mainWindow = null
  })
}

app.whenReady().then(() => {
  runtimeLogger.initSession()
  appLogger.log('app.ready', {
    platform: process.platform,
    runtime: runtimeLogger.getInfo()
  })
  configureMediaPermissions(session.defaultSession)

  ipcMain.handle('pty:start', async (_event, dimensions) => {
    terminalSession?.start(dimensions)
    queueStartupUpdateCheck()
    return { ok: true }
  })

  ipcMain.on('pty:input', (_event, data) => {
    terminalSession?.write(data)
  })

  ipcMain.on('pty:resize', (_event, dimensions) => {
    terminalSession?.resize(dimensions)
  })

  ipcMain.on('runtime:log', (_event, payload = {}) => {
    const window = BrowserWindow.fromWebContents(_event.sender)

    runtimeLogger.log(payload.type || 'renderer.event', payload.payload || {}, {
      component: 'renderer',
      processType: 'renderer',
      webContentsId: _event.sender.id,
      windowId: window?.id || null
    })
  })

  ipcMain.handle('runtime:info', async () => {
    return runtimeLogger.getInfo()
  })

  ipcMain.handle('clipboard:read-text', async () => clipboard.readText())

  ipcMain.handle('clipboard:write-text', async (_event, text) => {
    clipboard.writeText(String(text || ''))
    return { ok: true }
  })

  ipcMain.handle('app:update-response', async (_event, action) => {
    if (!activeUpdateInfo) {
      return {
        ok: true,
        dismissed: true
      }
    }

    if (action !== 'accept') {
      runtimeLogger.log('app.update_prompt_dismissed', {
        action: String(action || 'dismiss')
      })
      activeUpdateInfo = null

      return {
        ok: true,
        dismissed: true
      }
    }

    if (isApplyingAppUpdate) {
      return {
        ok: true,
        pending: true
      }
    }

    isApplyingAppUpdate = true

    runtimeLogger.log('app.update_apply_started', {
      strategy: activeUpdateInfo.strategy,
      currentLabel: activeUpdateInfo.currentLabel,
      latestLabel: activeUpdateInfo.latestLabel
    })
    sendStatus('Updating WSL Voice Terminal. The app will restart when it finishes.')

    try {
      const result = await appUpdater.applyUpdate()

      runtimeLogger.log('app.update_apply_ready', result)

      if (result.relaunchMode === 'stable') {
        launchStableInstall(result.launchScriptPath, result.stableRepoDir)
        app.exit(0)
        return {
          ok: true,
          relaunching: true
        }
      }

      app.relaunch()
      app.exit(0)
      return {
        ok: true,
        relaunching: true
      }
    } catch (error) {
      isApplyingAppUpdate = false
      activeUpdateInfo = null
      runtimeLogger.log('app.update_apply_failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  })

  ipcMain.handle('stt:transcribe', async (_event, payload) => {
    const requestedProvider = openAIClient.hasApiKey() ? 'openai' : 'local-whisper'

    runtimeLogger.log('stt.request', {
      provider: requestedProvider,
      apiKeyState: openAIClient.getApiKeyState().reason,
      mimeType: payload.mimeType || ''
    })

    try {
      if (!openAIClient.hasApiKey()) {
        return await transcribeWithLocalWhisper(payload, openAIClient.getApiKeyState().reason)
      }

      const transcript = await openAIClient.transcribeAudio(payload.audioBuffer, payload.mimeType)

      runtimeLogger.log('stt.success', {
        provider: 'openai',
        text: transcript
      })
      return transcript
    } catch (error) {
      if (!isInvalidApiKeyError(error)) {
        runtimeLogger.log('stt.error', {
          provider: requestedProvider,
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }

      runtimeLogger.log('stt.fallback', {
        from: 'openai',
        to: 'local-whisper',
        message: error instanceof Error ? error.message : String(error)
      })

      return transcribeWithLocalWhisper(payload, openAIClient.getApiKeyState().reason)
    }
  })

  ipcMain.handle('speech:preview', async (_event, payload) => {
    runtimeLogger.log('speech.preview_request', {
      text: payload.text || ''
    })

    const audioPayload = await ttsService.synthesizeSpeech(payload.text || '')

    runtimeLogger.log('speech.preview_ready', {
      provider: audioPayload?.provider || '',
      mimeType: audioPayload?.mimeType || '',
      text: payload.text || ''
    })

    return {
      audioBase64: audioPayload?.audioBuffer ? audioPayload.audioBuffer.toString('base64') : '',
      mimeType: audioPayload?.mimeType || 'audio/mpeg',
      provider: audioPayload?.provider || '',
      text: payload.text || ''
    }
  })

  ipcMain.handle('speech:set-enabled', async (_event, enabled) => {
    const normalizedEnabled = Boolean(enabled)

    terminalSession?.setAutoReplySpeechEnabled(normalizedEnabled)
    runtimeLogger.log('speech.auto_reply_toggled', {
      enabled: normalizedEnabled
    })

    return {
      ok: true,
      enabled: normalizedEnabled
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', async () => {
  await appLogger.log('app.before_quit', {})
  await runtimeLogger.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function configureMediaPermissions(electronSession) {
  if (!electronSession) {
    return
  }

  if (typeof electronSession.setDevicePermissionHandler === 'function') {
    electronSession.setDevicePermissionHandler((details) => {
      runtimeLogger.log('permissions.device_request', {
        deviceType: details.deviceType || ''
      }, {
        component: 'permissions',
        processType: 'main'
      })
      return details.deviceType === 'audioCapture'
    })
  }

  electronSession.setPermissionCheckHandler((_webContents, permission, _origin, details = {}) => {
    const allowed = isAudioMediaPermission(permission, details)

    runtimeLogger.log('permissions.check', {
      permission,
      mediaType: details.mediaType || '',
      mediaTypes: details.mediaTypes || [],
      allowed
    }, {
      component: 'permissions',
      processType: 'main'
    })

    return allowed
  })

  electronSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details = {}) => {
      const allowed = isAudioMediaPermission(permission, details)

      runtimeLogger.log('permissions.request', {
        permission,
        mediaType: details.mediaType || '',
        mediaTypes: details.mediaTypes || [],
        allowed
      }, {
        component: 'permissions',
        processType: 'main'
      })
      callback(allowed)
    }
  )
}

function announceInitialSpeechMode() {
  const apiKeyState = openAIClient.getApiKeyState()

  if (apiKeyState.reason === 'missing' || apiKeyState.reason === 'placeholder') {
    sendStatusOnce(`stt.local_only.${apiKeyState.reason}`, getLocalOnlyMessage(apiKeyState.reason))
  }
}

function queueStartupUpdateCheck() {
  if (hasCheckedForAppUpdate) {
    return
  }

  hasCheckedForAppUpdate = true

  checkForAppUpdate().catch((error) => {
    runtimeLogger.log('app.update_check_failed', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

async function checkForAppUpdate() {
  const updateInfo = await appUpdater.checkForUpdate()

  runtimeLogger.log('app.update_check', {
    available: updateInfo.available,
    strategy: updateInfo.strategy || '',
    reason: updateInfo.reason || '',
    currentLabel: updateInfo.currentLabel || '',
    latestLabel: updateInfo.latestLabel || '',
    migratesToStablePath: Boolean(updateInfo.migratesToStablePath)
  })

  if (!updateInfo.available) {
    return
  }

  activeUpdateInfo = updateInfo
  terminalSession?.send('app:update-available', {
    title: 'Update Available',
    message: buildUpdatePrompt(updateInfo),
    currentLabel: updateInfo.currentLabel,
    latestLabel: updateInfo.latestLabel,
    confirmLabel: 'Yes, update',
    cancelLabel: 'No'
  })
}

function sendStatus(message) {
  if (!message) {
    return
  }

  terminalSession?.send('app:status', { message })
}

function launchStableInstall(launchScriptPath, workingDirectory) {
  if (!launchScriptPath) {
    throw new Error('launch-wsl-voice-terminal.bat is missing after the update.')
  }

  const child = spawn(
    'cmd.exe',
    ['/c', 'start', '', launchScriptPath],
    {
      cwd: workingDirectory || path.dirname(launchScriptPath),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  )

  child.unref()
}

function sendStatusOnce(key, message) {
  if (!key || !message || statusNoticeKeys.has(key)) {
    return
  }

  statusNoticeKeys.add(key)
  runtimeLogger.log('app.status', {
    key,
    message
  })
  sendStatus(message)
}

function forwardLocalWhisperStatus(message) {
  runtimeLogger.log('stt.status', {
    provider: 'local-whisper',
    message
  })
  sendStatus(message)
}

function warmLocalWhisperRuntime() {
  localWhisperClient.prepareRuntime((message) => {
    forwardLocalWhisperStatus(message)
  }).catch((error) => {
    runtimeLogger.log('stt.runtime_setup_failed', {
      provider: 'local-whisper',
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

async function transcribeWithLocalWhisper(payload, fallbackReason = '') {
  const reason = fallbackReason || openAIClient.getApiKeyState().reason

  if (reason && reason !== 'configured') {
    sendStatusOnce(`stt.local_only.${reason}`, getLocalOnlyMessage(reason))
  }

  const transcript = await localWhisperClient.transcribeAudio(
    payload.audioBuffer,
    payload.mimeType,
    (message) => {
      forwardLocalWhisperStatus(message)
    }
  )

  runtimeLogger.log('stt.success', {
    provider: 'local-whisper',
    fallbackReason: reason,
    text: transcript
  })

  return transcript
}

function getLocalOnlyMessage(reason) {
  if (reason === 'auth-failed') {
    return 'OpenAI API key was rejected. Using local Whisper for this session.'
  }

  return 'No valid OpenAI API key found. Using local Whisper.'
}

function isAudioMediaPermission(permission, details = {}) {
  if (permission === 'audioCapture') {
    return true
  }

  if (permission !== 'media') {
    return false
  }

  if (Array.isArray(details.mediaTypes)) {
    return details.mediaTypes.includes('audio')
  }

  return details.mediaType === 'audio'
}

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) {
    return
  }

  const raw = fs.readFileSync(dotEnvPath, 'utf8')

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()

    if (!key || process.env[key]) {
      continue
    }

    let value = trimmed.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}
