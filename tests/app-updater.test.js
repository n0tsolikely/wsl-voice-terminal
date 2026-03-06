const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { AppUpdater, buildUpdatePrompt, compareVersions } = require('../lib/app-updater')

test('compareVersions handles basic semver ordering', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('0.2.0-beta', '0.2.0'), -1)
})

test('checkForUpdate uses git commit comparison when the repo has .git metadata', async () => {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsl-voice-terminal-'))

  await fs.promises.writeFile(path.join(baseDir, 'install.ps1'), '# install\n', 'utf8')
  await fs.promises.mkdir(path.join(baseDir, '.git'))

  const updater = new AppUpdater({
    baseDir,
    platform: 'win32',
    appVersion: '0.2.0',
    runCommand: async (_command, args) => {
      if (args[0] === 'rev-parse') {
        return '1111111111111111111111111111111111111111'
      }

      if (args[0] === 'status') {
        return ''
      }

      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        sha: '2222222222222222222222222222222222222222'
      })
    })
  })

  const result = await updater.checkForUpdate()

  assert.equal(result.available, true)
  assert.equal(result.strategy, 'git')
  assert.equal(result.currentLabel, '1111111')
  assert.equal(result.latestLabel, '2222222')
})

test('checkForUpdate falls back to version checks when the install is not a git repo', async () => {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsl-voice-terminal-'))

  await fs.promises.writeFile(path.join(baseDir, 'install.ps1'), '# install\n', 'utf8')

  const updater = new AppUpdater({
    baseDir,
    platform: 'win32',
    appVersion: '0.2.0',
    runCommand: async () => '',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        version: '0.3.0'
      })
    })
  })

  const result = await updater.checkForUpdate()

  assert.equal(result.available, true)
  assert.equal(result.strategy, 'version')
  assert.equal(result.currentLabel, 'v0.2.0')
  assert.equal(result.latestLabel, 'v0.3.0')
  assert.equal(result.migratesToStablePath, true)
})

test('applyUpdate runs install.ps1 in place for git repos', async () => {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsl-voice-terminal-'))
  const calls = []

  await fs.promises.writeFile(path.join(baseDir, 'install.ps1'), '# install\n', 'utf8')
  await fs.promises.mkdir(path.join(baseDir, '.git'))

  const updater = new AppUpdater({
    baseDir,
    platform: 'win32',
    appVersion: '0.2.0',
    runCommand: async (command, args, options) => {
      calls.push({
        command,
        args,
        cwd: options.cwd
      })
      return ''
    }
  })

  const result = await updater.applyUpdate()

  assert.equal(result.relaunchMode, 'self')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args.slice(-1), ['-NoLaunch'])
})

test('applyUpdate prefers the stable repo path for non-git installs', async () => {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsl-voice-terminal-'))
  const calls = []

  await fs.promises.writeFile(path.join(baseDir, 'install.ps1'), '# install\n', 'utf8')

  const updater = new AppUpdater({
    baseDir,
    platform: 'win32',
    appVersion: '0.2.0',
    runCommand: async (command, args, options) => {
      calls.push({
        command,
        args,
        cwd: options.cwd
      })
      return ''
    }
  })

  const result = await updater.applyUpdate()

  assert.equal(result.relaunchMode, 'stable')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.includes('-PreferStableRepo'), true)
})

test('buildUpdatePrompt mentions stable migration for non-git installs', () => {
  const message = buildUpdatePrompt({
    available: true,
    strategy: 'version',
    currentLabel: 'v0.2.0',
    latestLabel: 'v0.3.0',
    migratesToStablePath: true
  })

  assert.match(message, /move this install into your standard updateable repo/i)
})
