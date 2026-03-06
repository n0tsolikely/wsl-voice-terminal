const { spawn } = require('node:child_process')

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

module.exports = {
  runCommand
}
