const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch {
    return null
  }
}

function commandExists(name) {
  if (process.platform === 'win32') {
    return Boolean(run(`where ${name}`))
  }
  return Boolean(run(`command -v ${name}`))
}

function log(label, message) {
  process.stdout.write(`[${label}] ${message}\n`)
}

function findRepoRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'))
        if (pkg.name === 'wsl-voice-terminal') {
          return dir
        }
      } catch {
        return dir
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function parseEnvFile(envPath) {
  const map = new Map()
  if (!fs.existsSync(envPath)) {
    return map
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    map.set(key, value)
  }
  return map
}

function isPlaceholderKey(value) {
  if (!value) return true
  const lowered = value.toLowerCase()
  return (
    lowered.includes('your_key_here') ||
    lowered.includes('replace_me') ||
    lowered.includes('changeme')
  )
}

function hasStartScript(pkg) {
  return Boolean(pkg?.scripts?.start)
}

function hasRebuildScript(pkg) {
  return Boolean(pkg?.scripts && pkg.scripts['rebuild:native'])
}

function hasNodePtyDependency(pkg) {
  return Boolean(pkg?.dependencies?.['node-pty'] || pkg?.optionalDependencies?.['node-pty'])
}

function getPythonInfo() {
  const py311 = run('py -3.11 --version')
  if (py311) {
    return { ok: true, label: py311 }
  }
  const python = run('python --version') || run('python3 --version')
  if (python) {
    return { ok: true, label: python }
  }
  return { ok: false, label: null }
}

function detectVsCppTools() {
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) {
    const vswherePath = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    if (fs.existsSync(vswherePath)) {
      const output = run(`"${vswherePath}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`)
      if (output) {
        return { detected: true, detail: output, source: 'vswhere' }
      }
    }
  }

  if (commandExists('vswhere')) {
    const output = run('vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath')
    if (output) {
      return { detected: true, detail: output, source: 'vswhere' }
    }
  }

  if (!programFilesX86) {
    return { detected: false, detail: null, source: null }
  }

  const vsRoot = path.join(programFilesX86, 'Microsoft Visual Studio', '2022')
  const editions = ['BuildTools', 'Community', 'Professional', 'Enterprise']
  for (const edition of editions) {
    const msvcRoot = path.join(vsRoot, edition, 'VC', 'Tools', 'MSVC')
    if (!fs.existsSync(msvcRoot)) continue
    let versions = []
    try {
      versions = fs.readdirSync(msvcRoot)
    } catch {
      versions = []
    }
    for (const version of versions) {
      const clPath = path.join(msvcRoot, version, 'bin', 'Hostx64', 'x64', 'cl.exe')
      if (fs.existsSync(clPath)) {
        return { detected: true, detail: clPath, source: 'cl.exe' }
      }
    }
  }

  return { detected: false, detail: null, source: null }
}

const repoRoot = findRepoRoot(process.cwd()) || process.cwd()
const pkgPath = path.join(repoRoot, 'package.json')
const hasPackage = fs.existsSync(pkgPath)
const pkg = hasPackage ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null

let warnCount = 0
let failCount = 0

if (hasPackage) {
  log('OK', `Repo detected: ${repoRoot}`)
} else {
  warnCount += 1
  log('WARN', `package.json not found. Run this from the repo root. Using ${repoRoot}`)
}

log('OK', `Node detected: ${process.version}`)

const npmVersion = run('npm -v')
if (npmVersion) {
  log('OK', `npm detected: ${npmVersion}`)
} else {
  failCount += 1
  log('FAIL', 'npm not found on PATH')
}

const gitVersion = run('git --version')
if (gitVersion) {
  log('OK', 'Git detected')
} else {
  failCount += 1
  log('FAIL', 'Git not found on PATH')
}

const pythonInfo = getPythonInfo()
if (pythonInfo.ok) {
  log('OK', `Python detected: ${pythonInfo.label}`)
} else {
  failCount += 1
  log('FAIL', 'Python not found (local Whisper needs Python 3.11)')
}

const wslSystemPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe')
const wslExists = fs.existsSync(wslSystemPath) || commandExists('wsl')
if (wslExists) {
  log('OK', 'WSL detected')
} else {
  failCount += 1
  log('FAIL', 'WSL not found. Run: wsl --install (then reboot)')
}

const vsCpp = detectVsCppTools()
if (vsCpp.detected) {
  log('OK', `Visual Studio C++ build tools detected (${vsCpp.source})`)
} else {
  warnCount += 1
  log('WARN', 'Visual Studio C++ build tools not detected. Install Visual Studio Build Tools with Desktop development with C++ if node-pty fails to build.')
}

const envPath = path.join(repoRoot, '.env')
if (fs.existsSync(envPath)) {
  log('OK', '.env exists')
} else {
  warnCount += 1
  log('WARN', '.env missing')
}

const envVars = parseEnvFile(envPath)
const envKey = envVars.get('OPENAI_API_KEY') || process.env.OPENAI_API_KEY || ''
if (!envKey) {
  warnCount += 1
  log('WARN', 'OPENAI_API_KEY missing')
} else if (isPlaceholderKey(envKey)) {
  warnCount += 1
  log('WARN', 'OPENAI_API_KEY is a placeholder value')
} else {
  log('OK', 'OPENAI_API_KEY present')
}

const launchBat = path.join(repoRoot, 'launch-wsl-voice-terminal.bat')
if (fs.existsSync(launchBat)) {
  log('OK', 'launch-wsl-voice-terminal.bat found')
} else {
  warnCount += 1
  log('WARN', 'launch-wsl-voice-terminal.bat missing')
}

const nodeModulesPath = path.join(repoRoot, 'node_modules')
if (fs.existsSync(nodeModulesPath)) {
  log('OK', 'node_modules present')
} else {
  failCount += 1
  log('FAIL', 'node_modules missing (run npm install)')
}

const nodePtyBinary = path.join(repoRoot, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')
if (hasNodePtyDependency(pkg)) {
  if (fs.existsSync(nodePtyBinary)) {
    log('OK', 'node-pty native module built')
  } else {
    failCount += 1
    log('FAIL', 'node-pty native module missing (run npm run rebuild:native)')
  }
} else {
  warnCount += 1
  log('WARN', 'node-pty dependency not detected in package.json')
}

const whisperReq = path.join(repoRoot, 'requirements.local-whisper.txt')
if (fs.existsSync(whisperReq)) {
  log('INFO', 'Local Whisper requirements present')
} else {
  log('INFO', 'Local Whisper requirements not found')
}

const venvWin = path.join(repoRoot, '.local-whisper-venv', 'Scripts', 'python.exe')
const venvPosix = path.join(repoRoot, '.local-whisper-venv', 'bin', 'python')
if (fs.existsSync(venvWin) || fs.existsSync(venvPosix)) {
  log('OK', 'Local Whisper venv present')
} else {
  warnCount += 1
  log('WARN', 'Local Whisper venv missing')
}

if (hasStartScript(pkg)) {
  log('OK', 'package.json start script found')
} else {
  failCount += 1
  log('FAIL', 'package.json start script missing')
}

if (hasRebuildScript(pkg)) {
  log('OK', 'rebuild:native script found')
} else {
  warnCount += 1
  log('WARN', 'rebuild:native script missing')
}

if (failCount > 0) {
  log('FAIL', `Doctor finished with ${failCount} failure(s) and ${warnCount} warning(s).`)
  process.exitCode = 1
} else if (warnCount > 0) {
  log('WARN', `Doctor finished with ${warnCount} warning(s).`)
} else {
  log('OK', 'Doctor finished without warnings')
}
