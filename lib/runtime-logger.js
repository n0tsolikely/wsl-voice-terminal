const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

class RuntimeLogger {
  constructor({ baseDir, runtimeDirName = `${path.basename(baseDir)}-runtime` }) {
    this.baseDir = baseDir
    this.runtimeDirName = runtimeDirName
    this.runtimeDir = path.join(path.dirname(baseDir), runtimeDirName)
    this.latestLogPath = path.join(this.runtimeDir, 'latest.jsonl')
    this.sessionLogPath = ''
    this.sessionId = ''
    this.writeQueue = Promise.resolve()
  }

  initSession() {
    if (this.sessionLogPath) {
      return this.sessionLogPath
    }

    fs.mkdirSync(this.runtimeDir, { recursive: true })
    const sessionId = buildSessionId()

    this.sessionId = sessionId
    this.sessionLogPath = path.join(this.runtimeDir, `${sessionId}.jsonl`)
    fs.writeFileSync(this.latestLogPath, '', 'utf8')
    this.log('runtime.session_started', {
      sessionId,
      host: os.hostname(),
      pid: process.pid,
      runtimeDir: this.runtimeDir,
      sessionLogPath: this.sessionLogPath
    }, {
      component: 'runtime'
    })

    return this.sessionLogPath
  }

  getInfo() {
    this.initSession()

    return {
      runtimeDir: this.runtimeDir,
      latestLogPath: this.latestLogPath,
      sessionLogPath: this.sessionLogPath,
      sessionId: this.sessionId
    }
  }

  child(baseContext = {}) {
    return {
      child: (nextContext = {}) => this.child({
        ...baseContext,
        ...nextContext
      }),
      flush: () => this.flush(),
      getInfo: () => this.getInfo(),
      log: (type, payload = {}, callContext = {}) =>
        this.log(type, payload, {
          ...baseContext,
          ...callContext
        })
    }
  }

  log(type, payload = {}, context = {}) {
    this.initSession()

    const entry = {
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      pid: process.pid,
      type,
      payload
    }

    if (context && Object.keys(context).length) {
      entry.context = context
    }

    const line = JSON.stringify(entry) + '\n'

    this.writeQueue = this.writeQueue
      .then(() =>
        Promise.all([
          fs.promises.appendFile(this.sessionLogPath, line, 'utf8'),
          fs.promises.appendFile(this.latestLogPath, line, 'utf8')
        ])
      )
      .catch(() => {})

    return this.writeQueue
  }

  flush() {
    return this.writeQueue
  }
}

function buildSessionId() {
  const now = new Date()

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '-',
    process.pid
  ].join('')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

module.exports = {
  RuntimeLogger
}
