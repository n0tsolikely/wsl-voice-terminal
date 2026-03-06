const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const pty = require('node-pty')
const {
  extractSpeechText,
  getLastNonEmptyLine,
  normalizeTerminalText
} = require('./lib/terminal-speech')

loadDotEnv(path.join(__dirname, '.env'))

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1'
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1'
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy'
const TTS_FORMAT = 'mp3'
const LOCAL_WHISPER_MODEL = process.env.LOCAL_WHISPER_MODEL || 'base.en'
const LOCAL_WHISPER_DEVICE = process.env.LOCAL_WHISPER_DEVICE || 'cpu'
const LOCAL_WHISPER_COMPUTE_TYPE = process.env.LOCAL_WHISPER_COMPUTE_TYPE || 'int8'
const LOCAL_WHISPER_LANGUAGE = process.env.LOCAL_WHISPER_LANGUAGE || 'en'
const MAX_TTS_CHARS = 4000

class OpenAIClient {
  hasApiKey() {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim())
  }

  get apiKey() {
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is missing. Local transcription fallback is available, but TTS still needs an API key.'
      )
    }

    return apiKey
  }

  async transcribeAudio(audioBuffer, mimeType) {
    const fileBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
    const fileBlob = new Blob([fileBuffer], { type: mimeType || 'audio/webm' })
    const form = new FormData()

    form.set('file', fileBlob, this.buildFilename(mimeType))
    form.set('model', TRANSCRIPTION_MODEL)
    form.set('response_format', 'json')

    const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form
    })

    if (!response.ok) {
      throw new Error(`Whisper request failed with ${response.status}: ${await response.text()}`)
    }

    const payload = await response.json()

    return typeof payload.text === 'string' ? payload.text.trim() : ''
  }

  async synthesizeSpeech(text) {
    const speechInput = text.trim().slice(0, MAX_TTS_CHARS)

    if (!speechInput) {
      return null
    }

    const response = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        response_format: TTS_FORMAT,
        input: speechInput
      })
    })

    if (!response.ok) {
      throw new Error(`TTS request failed with ${response.status}: ${await response.text()}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  buildFilename(mimeType) {
    const extensionMap = {
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'webm'
    }

    return `recording.${extensionMap[mimeType] || 'webm'}`
  }
}

class LocalWhisperClient {
  constructor() {
    this.runtimePromise = null
  }

  get requirementsPath() {
    return path.join(__dirname, 'requirements.local-whisper.txt')
  }

  get scriptPath() {
    return path.join(__dirname, 'scripts', 'local_whisper_transcribe.py')
  }

  get venvDir() {
    return path.join(__dirname, '.local-whisper-venv')
  }

  get venvPythonPath() {
    return process.platform === 'win32'
      ? path.join(this.venvDir, 'Scripts', 'python.exe')
      : path.join(this.venvDir, 'bin', 'python')
  }

  async transcribeAudio(audioBuffer, mimeType, onStatus = () => {}) {
    const fileBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
    const tempPath = path.join(
      os.tmpdir(),
      `wsl-voice-terminal-${crypto.randomUUID()}.${this.buildExtension(mimeType)}`
    )

    await fs.promises.writeFile(tempPath, fileBuffer)

    try {
      await this.ensureRuntime(onStatus)
      onStatus(`Running local transcription with ${LOCAL_WHISPER_MODEL}...`)

      const stdout = await this.runVenvPython([
        this.scriptPath,
        '--audio-path',
        tempPath,
        '--model',
        LOCAL_WHISPER_MODEL,
        '--device',
        LOCAL_WHISPER_DEVICE,
        '--compute-type',
        LOCAL_WHISPER_COMPUTE_TYPE,
        '--language',
        LOCAL_WHISPER_LANGUAGE
      ])
      const payload = JSON.parse(stdout || '{}')

      return typeof payload.text === 'string' ? payload.text.trim() : ''
    } catch (error) {
      throw new Error(`Local faster-whisper transcription failed: ${error.message}`)
    } finally {
      fs.promises.unlink(tempPath).catch(() => {})
    }
  }

  async ensureRuntime(onStatus) {
    if (!this.runtimePromise) {
      this.runtimePromise = this.setupRuntime(onStatus).catch((error) => {
        this.runtimePromise = null
        throw error
      })
    }

    return this.runtimePromise
  }

  async setupRuntime(onStatus) {
    if (!fs.existsSync(this.venvPythonPath)) {
      onStatus('Setting up local faster-whisper runtime...')
      const launcher = await this.resolvePythonLauncher()

      await runCommand(launcher.command, [...launcher.args, '-m', 'venv', this.venvDir], {
        cwd: __dirname
      })
    }

    if (await this.hasInstalledRuntime()) {
      return
    }

    onStatus('Installing local faster-whisper fallback. First run can take a minute...')
    await this.runVenvPython([
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '-r',
      this.requirementsPath
    ])
  }

  async resolvePythonLauncher() {
    const candidates = []

    if (process.env.LOCAL_WHISPER_PYTHON) {
      candidates.push({
        command: process.env.LOCAL_WHISPER_PYTHON,
        args: []
      })
    }

    if (process.platform === 'win32') {
      candidates.push(
        { command: 'py', args: ['-3'] },
        { command: 'python', args: [] },
        { command: 'python3', args: [] }
      )
    } else {
      candidates.push(
        { command: 'python3', args: [] },
        { command: 'python', args: [] }
      )
    }

    for (const candidate of candidates) {
      try {
        await runCommand(candidate.command, [...candidate.args, '--version'], {
          cwd: __dirname
        })
        return candidate
      } catch (_error) {
        // Try the next available launcher.
      }
    }

    throw new Error('Python 3.9+ is required for the local faster-whisper fallback.')
  }

  async hasInstalledRuntime() {
    if (!fs.existsSync(this.venvPythonPath)) {
      return false
    }

    try {
      await this.runVenvPython([
        '-c',
        'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("faster_whisper") else 1)'
      ])
      return true
    } catch (_error) {
      return false
    }
  }

  async runVenvPython(args) {
    return runCommand(this.venvPythonPath, args, {
      cwd: __dirname
    })
  }

  buildExtension(mimeType) {
    const extensionMap = {
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'webm'
    }

    return extensionMap[mimeType] || 'webm'
  }
}

class CodexSpeechInterceptor {
  constructor(onFinalizedText) {
    this.onFinalizedText = onFinalizedText
    this.reset()
  }

  reset() {
    this.codexSessionActive = false
    this.pendingResponse = false
    this.inputBuffer = ''
    this.lastSubmittedInput = ''
    this.captureBuffer = ''
    this.lastEmittedText = ''
    this.idleTimer = null
    this.sawAltScreenExit = false
  }

  dispose() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  observeInput(data) {
    for (const char of data) {
      if (char === '\u0003') {
        this.pendingResponse = false
        this.captureBuffer = ''
        continue
      }

      if (char === '\u007f' || char === '\b') {
        this.inputBuffer = this.inputBuffer.slice(0, -1)
        continue
      }

      if (char === '\r' || char === '\n') {
        const submitted = this.inputBuffer.trim()

        if (/^codex(?:\s|$)/.test(submitted)) {
          this.codexSessionActive = true
        }

        if (this.codexSessionActive) {
          this.pendingResponse = true
          this.captureBuffer = ''
          this.lastSubmittedInput = submitted
        }

        this.inputBuffer = ''
        continue
      }

      if (char >= ' ') {
        this.inputBuffer += char
      }
    }
  }

  observeOutput(chunk) {
    const plainChunk = normalizeTerminalText(chunk, { trimEdges: false })

    if (!this.codexSessionActive && this.looksLikeCodexSurface(plainChunk)) {
      this.codexSessionActive = true
    }

    if (!this.codexSessionActive || !this.pendingResponse) {
      return
    }

    if (chunk.includes('\u001b[?1049l') || chunk.includes('\u001b[?47l')) {
      this.sawAltScreenExit = true
    }

    if (!plainChunk) {
      return
    }

    this.captureBuffer += plainChunk

    if (this.captureBuffer.length > 30000) {
      this.captureBuffer = this.captureBuffer.slice(-30000)
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      this.maybeFinalize()
    }, 1200)
  }

  maybeFinalize() {
    const normalized = normalizeTerminalText(this.captureBuffer)

    if (!normalized) {
      return
    }

    const lines = normalized
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, collection) => !(line === '' && index === collection.length - 1))
    const lastLine = getLastNonEmptyLine(lines)
    let candidateLines = [...lines]

    if (candidateLines.length && this.lastSubmittedInput) {
      const firstLine = candidateLines[0].trim()

      if (firstLine.includes(this.lastSubmittedInput)) {
        candidateLines.shift()
      }
    }

    while (candidateLines.length && this.isPromptLine(candidateLines[candidateLines.length - 1])) {
      candidateLines.pop()
    }

    const spokenText = extractSpeechText(candidateLines.join('\n'))
    const ended =
      this.sawAltScreenExit ||
      this.isPromptLine(lastLine) ||
      Boolean(spokenText && (/[.!?]$/.test(spokenText) || spokenText.split(/\s+/).length >= 10))

    if (!ended) {
      return
    }

    this.pendingResponse = false
    this.captureBuffer = ''
    this.sawAltScreenExit = false

    if (this.isShellPrompt(lastLine)) {
      this.codexSessionActive = false
    }

    if (!spokenText || spokenText === this.lastEmittedText) {
      return
    }

    this.lastEmittedText = spokenText
    this.onFinalizedText(spokenText)
  }

  isPromptLine(line) {
    return this.isCodexPrompt(line) || this.isShellPrompt(line)
  }

  isCodexPrompt(line) {
    return /^(?:>|>>|›|»|❯|You:|User:|Human:|Prompt:)\s*$/.test(line.trim())
  }

  looksLikeCodexSurface(text) {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const lastLine = getLastNonEmptyLine(lines)

    if (this.isCodexPrompt(lastLine)) {
      return true
    }

    return lines.some((line) => /\b(?:OpenAI\s+)?codex\b/i.test(line))
  }

  isShellPrompt(line) {
    const trimmed = line.trim()

    return (
      /^[^@\s]+@[^:\s]+:[^#$\n]+[$#]\s*$/.test(trimmed) ||
      /^PS [^>]+>\s*$/.test(trimmed) ||
      /^[A-Za-z]:\\.*>\s*$/.test(trimmed)
    )
  }
}

class TerminalSession {
  constructor(window, openAIClient) {
    this.window = window
    this.openAIClient = openAIClient
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
        const audioBuffer = await this.openAIClient.synthesizeSpeech(text)

        if (!audioBuffer) {
          return
        }

        this.send('speech:audio', {
          audioBase64: audioBuffer.toString('base64'),
          mimeType: 'audio/mpeg',
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
const openAIClient = new OpenAIClient()
const localWhisperClient = new LocalWhisperClient()

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

  terminalSession = new TerminalSession(mainWindow, openAIClient)
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
    const audioBuffer = await openAIClient.synthesizeSpeech(payload.text || '')

    return {
      audioBase64: audioBuffer ? audioBuffer.toString('base64') : '',
      mimeType: 'audio/mpeg',
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

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`
      reject(new Error(detail))
    })
  })
}
