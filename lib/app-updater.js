const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_REPO_OWNER = 'n0tsolikely'
const DEFAULT_REPO_NAME = 'wsl-voice-terminal'
const DEFAULT_BRANCH = 'main'

class AppUpdater {
  constructor({
    baseDir,
    runCommand,
    fetchImpl = global.fetch,
    platform = process.platform,
    appVersion = '0.0.0',
    repoOwner = DEFAULT_REPO_OWNER,
    repoName = DEFAULT_REPO_NAME,
    branch = DEFAULT_BRANCH
  }) {
    this.baseDir = baseDir
    this.runCommand = runCommand
    this.fetchImpl = fetchImpl
    this.platform = platform
    this.appVersion = appVersion
    this.repoOwner = repoOwner
    this.repoName = repoName
    this.branch = branch
  }

  get installScriptPath() {
    return path.join(this.baseDir, 'install.ps1')
  }

  get launchScriptPath() {
    return path.join(this.baseDir, 'launch-wsl-voice-terminal.bat')
  }

  get stableRepoDir() {
    const homeDir = process.env.USERPROFILE || process.env.HOME || this.baseDir

    return path.join(homeDir, this.repoName)
  }

  hasGitRepo() {
    return fs.existsSync(path.join(this.baseDir, '.git'))
  }

  async checkForUpdate() {
    if (this.platform !== 'win32') {
      return {
        available: false,
        reason: 'unsupported-platform'
      }
    }

    if (!fs.existsSync(this.installScriptPath)) {
      return {
        available: false,
        reason: 'install-script-missing'
      }
    }

    if (this.hasGitRepo()) {
      return this.checkGitUpdate()
    }

    return this.checkVersionUpdate()
  }

  async applyUpdate() {
    const preferStableRepo = !this.hasGitRepo()

    await this.runInstallScript({
      preferStableRepo
    })

    return {
      relaunchMode: preferStableRepo ? 'stable' : 'self',
      stableRepoDir: this.stableRepoDir,
      launchScriptPath: path.join(this.stableRepoDir, 'launch-wsl-voice-terminal.bat')
    }
  }

  async checkGitUpdate() {
    const localSha = await this.runCommand('git', ['rev-parse', 'HEAD'], {
      cwd: this.baseDir
    })
    const dirtyOutput = await this.runCommand('git', ['status', '--porcelain'], {
      cwd: this.baseDir
    })
    const remoteSha = await this.fetchRemoteHeadSha()

    if (!remoteSha || normalizeSha(localSha) === normalizeSha(remoteSha)) {
      return {
        available: false,
        reason: 'up-to-date',
        strategy: 'git',
        currentLabel: shortenSha(localSha),
        latestLabel: shortenSha(remoteSha || localSha)
      }
    }

    return {
      available: true,
      strategy: 'git',
      currentLabel: shortenSha(localSha),
      latestLabel: shortenSha(remoteSha),
      isDirty: Boolean(String(dirtyOutput || '').trim())
    }
  }

  async checkVersionUpdate() {
    const remoteVersion = await this.fetchRemotePackageVersion()
    const comparison = compareVersions(remoteVersion, this.appVersion)

    if (!remoteVersion || comparison <= 0) {
      return {
        available: false,
        reason: 'up-to-date',
        strategy: 'version',
        currentLabel: `v${this.appVersion}`,
        latestLabel: `v${remoteVersion || this.appVersion}`
      }
    }

    return {
      available: true,
      strategy: 'version',
      currentLabel: `v${this.appVersion}`,
      latestLabel: `v${remoteVersion}`,
      migratesToStablePath: true
    }
  }

  async runInstallScript({ preferStableRepo = false } = {}) {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.installScriptPath,
      '-NoLaunch'
    ]

    if (preferStableRepo) {
      args.push('-PreferStableRepo')
    }

    await this.runCommand('powershell.exe', args, {
      cwd: this.baseDir
    })
  }

  async fetchRemoteHeadSha() {
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits/${this.branch}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'WSL-Voice-Terminal'
        }
      }
    )

    if (!response.ok) {
      throw new Error(`GitHub update check failed with ${response.status}.`)
    }

    const payload = await response.json()

    return String(payload?.sha || '').trim()
  }

  async fetchRemotePackageVersion() {
    const response = await this.fetchImpl(
      `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/${this.branch}/package.json`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'WSL-Voice-Terminal'
        }
      }
    )

    if (!response.ok) {
      throw new Error(`GitHub package version check failed with ${response.status}.`)
    }

    const payload = await response.json()

    return String(payload?.version || '').trim()
  }
}

function buildUpdatePrompt(updateInfo) {
  if (!updateInfo?.available) {
    return ''
  }

  if (updateInfo.strategy === 'version') {
    return [
      `A newer WSL Voice Terminal build is available (${updateInfo.currentLabel} -> ${updateInfo.latestLabel}).`,
      updateInfo.migratesToStablePath
        ? 'Updating now will move this install into your standard updateable repo under USERPROFILE\\wsl-voice-terminal.'
        : 'Update now and restart into the latest version?'
    ].join(' ')
  }

  const dirtyNote = updateInfo.isDirty
    ? ' Local repo changes may block the update.'
    : ''

  return `A newer WSL Voice Terminal build is available (${updateInfo.currentLabel} -> ${updateInfo.latestLabel}). Update now and restart into the latest version?${dirtyNote}`
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  const length = Math.max(leftParts.core.length, rightParts.core.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts.core[index] || 0
    const rightValue = rightParts.core[index] || 0

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1
    }
  }

  if (leftParts.tag === rightParts.tag) {
    return 0
  }

  if (!leftParts.tag) {
    return 1
  }

  if (!rightParts.tag) {
    return -1
  }

  return leftParts.tag.localeCompare(rightParts.tag)
}

function parseVersion(value) {
  const normalized = String(value || '0.0.0').trim()
  const [core, tag = ''] = normalized.split('-', 2)

  return {
    core: core
      .split('.')
      .map((segment) => Number.parseInt(segment, 10))
      .filter((segment) => Number.isFinite(segment)),
    tag
  }
}

function shortenSha(value) {
  return normalizeSha(value).slice(0, 7)
}

function normalizeSha(value) {
  return String(value || '').trim().toLowerCase()
}

module.exports = {
  AppUpdater,
  buildUpdatePrompt,
  compareVersions
}
