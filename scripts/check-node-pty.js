const quiet = process.argv.includes('--quiet')

function print(level, message) {
  if (!quiet) {
    process.stdout.write(`[${level}] ${message}\n`)
  }
}

try {
  const nodePty = require('node-pty')
  if (typeof nodePty?.spawn !== 'function') {
    throw new Error('node-pty loaded but spawn export is missing')
  }

  print('OK', 'node-pty module load validation passed')
  process.exit(0)
} catch (error) {
  const message = error && error.message ? error.message : String(error)
  print('WARN', `node-pty module load validation failed: ${message}`)
  process.exit(1)
}
