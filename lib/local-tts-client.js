const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

class LocalTtsClient {
  constructor({ baseDir, runCommand, voice = '', maxTtsChars = 4000 }) {
    this.baseDir = baseDir
    this.runCommand = runCommand
    this.voice = voice
    this.maxTtsChars = maxTtsChars
  }

  get scriptPath() {
    return path.join(this.baseDir, 'scripts', 'local_tts_to_wave.ps1')
  }

  isAvailable() {
    return process.platform === 'win32'
  }

  async synthesizeSpeech(text) {
    const speechInput = text.trim().slice(0, this.maxTtsChars)

    if (!speechInput) {
      return null
    }

    if (!this.isAvailable()) {
      throw new Error('Local Windows TTS is only available when this app is running on Windows.')
    }

    const tempToken = crypto.randomUUID()
    const textPath = path.join(os.tmpdir(), `wsl-voice-terminal-${tempToken}.txt`)
    const outPath = path.join(os.tmpdir(), `wsl-voice-terminal-${tempToken}.wav`)

    await fs.promises.writeFile(textPath, speechInput, 'utf8')

    try {
      const args = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.scriptPath,
        '-TextPath',
        textPath,
        '-OutPath',
        outPath
      ]

      if (this.voice.trim()) {
        args.push('-Voice', this.voice.trim())
      }

      await this.runCommand('powershell.exe', args, {
        cwd: this.baseDir
      })

      return fs.promises.readFile(outPath)
    } catch (error) {
      throw new Error(`Local Windows TTS failed: ${error.message}`)
    } finally {
      fs.promises.unlink(textPath).catch(() => {})
      fs.promises.unlink(outPath).catch(() => {})
    }
  }
}

module.exports = {
  LocalTtsClient
}
