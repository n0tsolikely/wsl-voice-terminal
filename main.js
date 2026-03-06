const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const pty = require('node-pty')
const { CodexSpeechInterceptor } = require('./lib/codex-speech-interceptor')
const { LocalTtsClient } = require('./lib/local-tts-client')
const { LocalWhisperClient } = require('./lib/local-whisper-client')
const { OpenAiAudioClient } = require('./lib/openai-audio-client')
const { runCommand } = require('./lib/run-command')
const { TTS_PROVIDERS } = require('./lib/tts-provider-selection')
const { TtsService } = require('./lib/tts-service')

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

class TerminalSession {
  constructor(window, ttsService) {
    this.window = window
    this.ttsService = ttsService
    this.ptyProcess = null
    this.speechQueue = Promise.resolve()
    this.speechInterceptor = new CodexSpeechInterceptor((spokenText) => {
      this.queueSpeech(spokenText)
    })
  }

  start({ cols, rows }) {
    if (this.ptyProcess) {
      return
    }

    if (process.platform !== 'win32') {
      throw new Error('This wrapper must be launched on Windows because the backend spawns wsl.exe.')
    }

    const shell = process.env.WSL_EXECUTABLE || 'wsl.exe'
    const args = splitArgs(process.env.WSL_ARGS || '')
    const cwd = process.env.USERPROFILE || os.homedir()
    const env = {
      ...process.env,
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color'
    }

    this.ptyProcess = pty.spawn(shell, args, {
      cols,
      rows,
      cwd,
      env,
      name: 'xterm-256color'
    })

    this.ptyProcess.onData((data) => {
      this.speechInterceptor.observeOutput(data)
      this.send('pty:data', data)
    })

    this.ptyProcess.onExit((event) => {
      this.send('pty:exit', event)
      this.ptyProcess = null
    })
  }

  write(data) {
    if (!this.ptyProcess) {
      return
    }

    this.speechInterceptor.observeInput(data)
    this.ptyProcess.write(data)
  }

  resize({ cols, rows }) {
    if (!this.ptyProcess) {
      return
    }

    this.ptyProcess.resize(cols, rows)
  }

  dispose() {
    this.speechInterceptor.dispose()
    this.disposePty()
  }

  disposePty() {
    const processRef = this.ptyProcess
    this.ptyProcess = null

    if (!processRef) {
      return
    }

    try {
      processRef.kill()
    } catch (_error) {
      // The PTY can already be dead by the time Electron tears the window down.
    }
  }

  queueSpeech(text) {
    this.speechQueue = this.speechQueue
      .then(async () => {
        const audioPayload = await this.ttsService.synthesizeSpeech(text)

        if (!audioPayload?.audioBuffer) {
          return
        }

        this.send('speech:audio', {
          audioBase64: audioPayload.audioBuffer.toString('base64'),
          mimeType: audioPayload.mimeType,
          provider: audioPayload.provider,
          text
        })
      })
      .catch((error) => {
        this.sendError(error)
      })
  }

  send(channel, payload) {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.window.webContents.send(channel, payload)
  }

  sendError(error) {
    this.send('app:error', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

let mainWindow = null
let terminalSession = null
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

  terminalSession = new TerminalSession(mainWindow, ttsService)
  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  mainWindow.on('closed', () => {
    terminalSession?.dispose()
    terminalSession = null
    mainWindow = null
  })
}

app.whenReady().then(() => {
  ipcMain.handle('pty:start', async (_event, dimensions) => {
    terminalSession?.start(dimensions)
    return { ok: true }
  })

  ipcMain.on('pty:input', (_event, data) => {
    terminalSession?.write(data)
  })

  ipcMain.on('pty:resize', (_event, dimensions) => {
    terminalSession?.resize(dimensions)
  })

  ipcMain.handle('stt:transcribe', async (_event, payload) => {
    if (openAIClient.hasApiKey()) {
      return openAIClient.transcribeAudio(payload.audioBuffer, payload.mimeType)
    }

    return localWhisperClient.transcribeAudio(payload.audioBuffer, payload.mimeType, (message) => {
      terminalSession?.send('app:status', { message })
    })
  })

  ipcMain.handle('speech:preview', async (_event, payload) => {
    const audioPayload = await ttsService.synthesizeSpeech(payload.text || '')

    return {
      audioBase64: audioPayload?.audioBuffer ? audioPayload.audioBuffer.toString('base64') : '',
      mimeType: audioPayload?.mimeType || 'audio/mpeg',
      provider: audioPayload?.provider || '',
      text: payload.text || ''
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function splitArgs(rawArgs) {
  if (!rawArgs.trim()) {
    return []
  }

  const matches = rawArgs.match(/(?:[^\s"]+|"[^"]*")+/g) || []
  return matches.map((entry) => entry.replace(/^"(.*)"$/, '$1'))
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
