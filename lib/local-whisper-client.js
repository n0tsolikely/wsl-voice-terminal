const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

class LocalWhisperClient {
  constructor({
    baseDir,
    runCommand,
    model = 'base.en',
    device = 'cpu',
    computeType = 'int8',
    language = 'en',
    pythonOverride = process.env.LOCAL_WHISPER_PYTHON || ''
  }) {
    this.baseDir = baseDir
    this.runCommand = runCommand
    this.model = model
    this.device = device
    this.computeType = computeType
    this.language = language
    this.pythonOverride = pythonOverride
    this.runtimePromise = null
  }

  get requirementsPath() {
    return path.join(this.baseDir, 'requirements.local-whisper.txt')
  }

  get scriptPath() {
    return path.join(this.baseDir, 'scripts', 'local_whisper_transcribe.py')
  }

  get venvDir() {
    return path.join(this.baseDir, '.local-whisper-venv')
  }

  get venvPythonPath() {
    return process.platform === 'win32'
      ? path.join(this.venvDir, 'Scripts', 'python.exe')
      : path.join(this.venvDir, 'bin', 'python')
  }

  get requirementsStampPath() {
    return path.join(this.venvDir, '.requirements.sha256')
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

      const stdout = await this.runVenvPython([
        this.scriptPath,
        '--audio-path',
        tempPath,
        '--model',
        this.model,
        '--device',
        this.device,
        '--compute-type',
        this.computeType,
        '--language',
        this.language
      ])
      const payload = JSON.parse(stdout || '{}')

      return typeof payload.text === 'string' ? payload.text.trim() : ''
    } catch (error) {
      throw new Error(`Local faster-whisper transcription failed: ${error.message}`)
    } finally {
      fs.promises.unlink(tempPath).catch(() => {})
    }
  }

  async prepareRuntime(onStatus = () => {}) {
    await this.ensureRuntime(onStatus)
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

      await this.runCommand(launcher.command, [...launcher.args, '-m', 'venv', this.venvDir], {
        cwd: this.baseDir
      })
    }

    const requirementsHash = await this.getRequirementsHash()
    const runtimeHealthy = await this.hasHealthyRuntime()
    const requirementsCurrent = await this.hasCurrentRequirements(requirementsHash)

    if (runtimeHealthy && requirementsCurrent) {
      return
    }

    onStatus(getRuntimeInstallMessage({
      runtimeHealthy,
      requirementsCurrent
    }))
    await this.runVenvPython([
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '-r',
      this.requirementsPath
    ])

    if (!(await this.hasHealthyRuntime())) {
      throw new Error('Local faster-whisper runtime is still unavailable after install.')
    }

    await fs.promises.writeFile(this.requirementsStampPath, requirementsHash, 'utf8')
  }

  async resolvePythonLauncher() {
    const candidates = []

    if (this.pythonOverride) {
      candidates.push({
        command: this.pythonOverride,
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
        await this.runCommand(candidate.command, [...candidate.args, '--version'], {
          cwd: this.baseDir
        })
        return candidate
      } catch (_error) {
        // Try the next available launcher.
      }
    }

    throw new Error('Python 3.9+ is required for the local faster-whisper fallback.')
  }

  async hasHealthyRuntime() {
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

  async hasCurrentRequirements(requirementsHash) {
    if (!requirementsHash || !fs.existsSync(this.requirementsStampPath)) {
      return false
    }

    try {
      const storedHash = await fs.promises.readFile(this.requirementsStampPath, 'utf8')

      return storedHash.trim() === requirementsHash
    } catch (_error) {
      return false
    }
  }

  async getRequirementsHash() {
    if (!fs.existsSync(this.requirementsPath)) {
      throw new Error('requirements.local-whisper.txt is missing.')
    }

    const contents = await fs.promises.readFile(this.requirementsPath)

    return crypto.createHash('sha256').update(contents).digest('hex')
  }

  async runVenvPython(args) {
    return this.runCommand(this.venvPythonPath, args, {
      cwd: this.baseDir
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

function getRuntimeInstallMessage({ runtimeHealthy, requirementsCurrent }) {
  if (!runtimeHealthy) {
    return 'Installing local faster-whisper fallback. First run can take a minute...'
  }

  if (!requirementsCurrent) {
    return 'Updating local faster-whisper fallback...'
  }

  return 'Checking local faster-whisper fallback...'
}

module.exports = {
  LocalWhisperClient
}
