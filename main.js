const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const pty = require('node-pty')
const { LocalTtsClient } = require('./lib/local-tts-client')
const { LocalWhisperClient } = require('./lib/local-whisper-client')
const { OpenAiAudioClient } = require('./lib/openai-audio-client')
const { runCommand } = require('./lib/run-command')
const { TerminalSession } = require('./lib/terminal-session')
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

  terminalSession = new TerminalSession({
    window: mainWindow,
    ttsService,
    spawnPty: pty.spawn
  })
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
