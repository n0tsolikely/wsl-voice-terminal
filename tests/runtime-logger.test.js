const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { RuntimeLogger } = require('../lib/runtime-logger')

test('runtime logger writes both session and latest logs in a sibling runtime directory', async () => {
  const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wsl-voice-terminal-'))
  const logger = new RuntimeLogger({
    baseDir,
    runtimeDirName: 'wsl-voice-terminal-runtime-test'
  })

  const info = logger.getInfo()

  await logger.log('test.event', {
    message: 'hello'
  })
  await logger.flush()

  const latestLog = await fs.promises.readFile(info.latestLogPath, 'utf8')
  const sessionLog = await fs.promises.readFile(info.sessionLogPath, 'utf8')

  assert.match(info.runtimeDir, /wsl-voice-terminal-runtime-test$/)
  assert.match(latestLog, /test\.event/)
  assert.match(sessionLog, /runtime\.session_started/)
  assert.match(sessionLog, /hello/)
})
