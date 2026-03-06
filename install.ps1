[CmdletBinding()]
param(
  [switch]$NoLaunch,
  [switch]$DoctorOnly,
  [switch]$LocalWhisperOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoName = 'wsl-voice-terminal'
$ExpectedRepoUrl = 'https://github.com/n0tsolikely/wsl-voice-terminal.git'
$StableRepoDir = Join-Path $env:USERPROFILE $RepoName
$Script:WarningCount = 0

function Write-Step($Message) {
  Write-Host "[STEP] $Message" -ForegroundColor Cyan
}

function Write-Pass($Message) {
  Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
  $Script:WarningCount += 1
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Stop-Install($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $segments = @($machinePath, $userPath) | Where-Object { $_ }
  $env:Path = ($segments -join ';')
}

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1

  if ($null -eq $command) {
    return $null
  }

  return $command.Source
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = (Get-Location).Path,
    [switch]$IgnoreExitCode
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if (-not $IgnoreExitCode -and $exitCode -ne 0) {
    throw "Command failed with exit code $exitCode: $FilePath $($Arguments -join ' ')"
  }

  return $exitCode
}

function Test-WslVoiceTerminalRepo([string]$Path) {
  $packageJsonPath = Join-Path $Path 'package.json'

  if (-not (Test-Path $packageJsonPath) -or -not (Test-Path (Join-Path $Path 'main.js'))) {
    return $false
  }

  try {
    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    return $packageJson.name -eq $RepoName
  } catch {
    return $false
  }
}

function Get-PackageJson([string]$RepoDir) {
  return Get-Content (Join-Path $RepoDir 'package.json') -Raw | ConvertFrom-Json
}

function Test-PackageScript([string]$RepoDir, [string]$ScriptName) {
  try {
    $packageJson = Get-PackageJson $RepoDir
    return $null -ne $packageJson.scripts.PSObject.Properties[$ScriptName]
  } catch {
    return $false
  }
}

function Test-Git {
  return [bool](Get-CommandPath 'git.exe') -or [bool](Get-CommandPath 'git')
}

function Test-Node {
  return [bool](Get-CommandPath 'node.exe') -or [bool](Get-CommandPath 'node')
}

function Test-Npm {
  return [bool](Get-CommandPath 'npm.cmd') -or [bool](Get-CommandPath 'npm')
}

function Test-Python311 {
  $pyPath = Get-CommandPath 'py.exe'
  if (-not $pyPath) {
    $pyPath = Get-CommandPath 'py'
  }

  if ($pyPath) {
    try {
      $exitCode = Invoke-Checked -FilePath $pyPath -Arguments @('-3.11', '--version') -IgnoreExitCode
      if ($exitCode -eq 0) {
        return $true
      }
    } catch {
      # Ignore and fall through to python.exe detection.
    }
  }

  $pythonPath = Get-CommandPath 'python.exe'
  if (-not $pythonPath) {
    $pythonPath = Get-CommandPath 'python'
  }

  if (-not $pythonPath) {
    return $false
  }

  try {
    $versionOutput = & $pythonPath --version 2>&1
    return [bool]($versionOutput -match '^Python 3\.11(\.\d+)?$')
  } catch {
    return $false
  }
}

function Ensure-Winget {
  Write-Step 'Checking winget'
  $wingetPath = Get-CommandPath 'winget.exe'
  if (-not $wingetPath) {
    $wingetPath = Get-CommandPath 'winget'
  }

  if (-not $wingetPath) {
    Stop-Install 'winget was not found. Install or update App Installer from the Microsoft Store, then rerun install.ps1.'
  }

  Write-Pass "winget detected at $wingetPath"
  return $wingetPath
}

function Ensure-WingetPackage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$WingetId,
    [Parameter(Mandatory = $true)]
    [scriptblock]$TestScript,
    [Parameter(Mandatory = $true)]
    [string]$WingetPath
  )

  Write-Step "Checking $Name"
  if (& $TestScript) {
    Write-Pass "$Name is already installed"
    return
  }

  Write-Step "Installing $Name with winget"
  Invoke-Checked -FilePath $WingetPath -Arguments @(
    'install',
    '--id',
    $WingetId,
    '--exact',
    '--source',
    'winget',
    '--accept-package-agreements',
    '--accept-source-agreements'
  )

  Refresh-Path

  if (& $TestScript) {
    Write-Pass "$Name installed successfully"
    return
  }

  Stop-Install "$Name install finished, but it is still not available in this PowerShell session. Open a new PowerShell window and rerun install.ps1."
}

function Resolve-RepoDir([string]$WingetPath) {
  $currentDir = (Get-Location).Path

  if (Test-WslVoiceTerminalRepo $currentDir) {
    Write-Step 'Checking current working directory'
    Write-Pass "Using current repo directory: $currentDir"
    return $currentDir
  }

  Write-Step "Preparing repo at $StableRepoDir"

  if (-not (Test-Path $StableRepoDir)) {
    Invoke-Checked -FilePath 'git' -Arguments @('clone', $ExpectedRepoUrl, $StableRepoDir)
    Write-Pass "Cloned repo to $StableRepoDir"
    return $StableRepoDir
  }

  if (-not (Test-Path (Join-Path $StableRepoDir '.git'))) {
    Stop-Install "$StableRepoDir already exists but is not a git clone. Remove or rename that folder, or run install.ps1 from inside your existing repo."
  }

  $originUrl = (& git -C $StableRepoDir remote get-url origin 2>$null).Trim()
  if (-not $originUrl) {
    Stop-Install "The repo at $StableRepoDir has no origin remote. Fix the repo manually or remove the folder and rerun install.ps1."
  }

  if ($originUrl -notmatch 'n0tsolikely/wsl-voice-terminal(?:\.git)?$') {
    Stop-Install "The repo at $StableRepoDir points to $originUrl, not $ExpectedRepoUrl. Remove or fix that repo before rerunning install.ps1."
  }

  $gitStatus = (& git -C $StableRepoDir status --porcelain)
  if ($gitStatus) {
    Stop-Install "The repo at $StableRepoDir has local changes. Commit, stash, or remove them before rerunning install.ps1."
  }

  Invoke-Checked -FilePath 'git' -Arguments @('-C', $StableRepoDir, 'fetch', 'origin')
  Invoke-Checked -FilePath 'git' -Arguments @('-C', $StableRepoDir, 'checkout', 'main')
  Invoke-Checked -FilePath 'git' -Arguments @('-C', $StableRepoDir, 'pull', '--ff-only', 'origin', 'main')
  Write-Pass "Repo is up to date at $StableRepoDir"

  return $StableRepoDir
}

function Ensure-EnvFile([string]$RepoDir) {
  $envExamplePath = Join-Path $RepoDir '.env.example'
  $envPath = Join-Path $RepoDir '.env'

  Write-Step 'Checking .env'
  if (Test-Path $envPath) {
    Write-Pass '.env already exists'
    return
  }

  if (-not (Test-Path $envExamplePath)) {
    Write-Warn '.env.example is missing. Skipping .env creation.'
    return
  }

  Copy-Item -Path $envExamplePath -Destination $envPath
  Write-Pass 'Created .env from .env.example'
}

function Get-PythonCommand {
  $pyPath = Get-CommandPath 'py.exe'
  if (-not $pyPath) {
    $pyPath = Get-CommandPath 'py'
  }

  if ($pyPath) {
    try {
      $exitCode = Invoke-Checked -FilePath $pyPath -Arguments @('-3.11', '--version') -IgnoreExitCode
      if ($exitCode -eq 0) {
        return @{
          FilePath = $pyPath
          Arguments = @('-3.11')
          Label = 'py -3.11'
        }
      }
    } catch {
      # Ignore and fall back to python.exe.
    }
  }

  $pythonPath = Get-CommandPath 'python.exe'
  if (-not $pythonPath) {
    $pythonPath = Get-CommandPath 'python'
  }

  if ($pythonPath) {
    return @{
      FilePath = $pythonPath
      Arguments = @()
      Label = 'python'
    }
  }

  return $null
}

function Ensure-LocalWhisperRuntime([string]$RepoDir) {
  Write-Step 'Checking local faster-whisper runtime'

  $pythonCommand = Get-PythonCommand
  if (-not $pythonCommand) {
    Write-Warn 'Python 3.11 is not available. Skipping local faster-whisper setup.'
    return
  }

  $venvDir = Join-Path $RepoDir '.local-whisper-venv'
  $venvPython = Join-Path $venvDir 'Scripts\python.exe'
  $requirementsPath = Join-Path $RepoDir 'requirements.local-whisper.txt'

  if (-not (Test-Path $venvPython)) {
    Write-Step "Creating Python virtual environment at $venvDir"
    Invoke-Checked -FilePath $pythonCommand.FilePath -Arguments ($pythonCommand.Arguments + @('-m', 'venv', $venvDir)) -WorkingDirectory $RepoDir
    Write-Pass 'Created local faster-whisper virtual environment'
  } else {
    Write-Pass 'Local faster-whisper virtual environment already exists'
  }

  if (-not (Test-Path $requirementsPath)) {
    Write-Warn 'requirements.local-whisper.txt is missing. Skipping local faster-whisper package install.'
    return
  }

  Write-Step 'Installing local faster-whisper requirements'
  Invoke-Checked -FilePath $venvPython -Arguments @(
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '-r',
    $requirementsPath
  ) -WorkingDirectory $RepoDir
  Write-Pass 'Local faster-whisper requirements installed'
}

function Run-NpmInstall([string]$RepoDir) {
  Write-Step 'Running npm install'

  try {
    Invoke-Checked -FilePath 'npm' -Arguments @('install') -WorkingDirectory $RepoDir
    Write-Pass 'npm install completed'
    return
  } catch {
    Write-Warn "npm install failed: $($_.Exception.Message)"
  }

  if (-not (Test-PackageScript -RepoDir $RepoDir -ScriptName 'rebuild:native')) {
    Stop-Install 'npm install failed and no rebuild:native script exists. Install Visual Studio C++ build tools and rerun install.ps1.'
  }

  Write-Step 'Attempting npm run rebuild:native'
  try {
    Invoke-Checked -FilePath 'npm' -Arguments @('run', 'rebuild:native') -WorkingDirectory $RepoDir
    Write-Pass 'rebuild:native completed'
  } catch {
    Stop-Install "npm install failed and rebuild:native also failed. Install the Visual Studio C++ build tools, then rerun install.ps1. $($_.Exception.Message)"
  }
}

function Check-Wsl {
  Write-Step 'Checking WSL'
  $wslPath = Get-CommandPath 'wsl.exe'
  if (-not $wslPath) {
    Write-Warn 'wsl.exe was not found. Install WSL from an elevated PowerShell window with: wsl --install. Reboot if Windows asks you to.'
    return $false
  }

  Write-Pass "WSL detected at $wslPath"
  return $true
}

function Run-Doctor([string]$RepoDir, [bool]$WslReady) {
  Write-Step 'Running doctor checks'

  if (Test-Npm) {
    Write-Pass 'npm is available'
  } else {
    Write-Warn 'npm is not available on PATH.'
  }

  if ($WslReady) {
    Write-Pass 'wsl.exe is available'
  } else {
    Write-Warn 'wsl.exe is missing'
  }

  if (Test-Path (Join-Path $RepoDir '.env')) {
    Write-Pass '.env exists'
  } else {
    Write-Warn '.env is missing'
  }

  if (Test-Path (Join-Path $RepoDir '.local-whisper-venv\Scripts\python.exe')) {
    Write-Pass 'Local faster-whisper virtual environment exists'
  } else {
    Write-Warn 'Local faster-whisper virtual environment is missing'
  }

  if (Test-Path (Join-Path $RepoDir 'node_modules')) {
    Write-Pass 'node_modules exists'
  } else {
    Write-Warn 'node_modules is missing'
  }

  Write-Pass 'Doctor finished'
}

function Launch-App([string]$RepoDir, [bool]$WslReady) {
  if ($NoLaunch -or $DoctorOnly -or $LocalWhisperOnly) {
    Write-Step 'Skipping launch'
    Write-Pass 'Launch skipped by installer option'
    return
  }

  if (-not $WslReady) {
    Stop-Install 'WSL Voice Terminal was installed, but launch was skipped because wsl.exe is missing. Run wsl --install in an elevated PowerShell window, reboot if required, then rerun install.ps1.'
  }

  $launchBat = Join-Path $RepoDir 'launch-wsl-voice-terminal.bat'

  Write-Step 'Launching WSL Voice Terminal'
  Push-Location $RepoDir
  try {
    if (Test-Path $launchBat) {
      & $launchBat
      $exitCode = $LASTEXITCODE
    } elseif (Test-PackageScript -RepoDir $RepoDir -ScriptName 'start') {
      & npm start
      $exitCode = $LASTEXITCODE
    } else {
      Stop-Install 'No launch-wsl-voice-terminal.bat or npm start script was found.'
    }
  } finally {
    Pop-Location
  }

  if ($exitCode -eq 0) {
    Write-Pass 'WSL Voice Terminal exited cleanly'
    return
  }

  Stop-Install "WSL Voice Terminal exited with code $exitCode"
}

if ($env:OS -ne 'Windows_NT') {
  Stop-Install 'install.ps1 only runs on Windows.'
}

$wingetPath = Ensure-Winget

if ($DoctorOnly) {
  Write-Step 'Doctor mode enabled'
  if (Test-Git) {
    Write-Pass 'Git is installed'
  } else {
    Write-Warn 'Git is missing'
  }

  if (Test-Node) {
    Write-Pass 'Node.js is installed'
  } else {
    Write-Warn 'Node.js is missing'
  }

  if (Test-Python311) {
    Write-Pass 'Python 3.11 is installed'
  } else {
    Write-Warn 'Python 3.11 is missing'
  }

  $doctorRepoDir = if (Test-WslVoiceTerminalRepo (Get-Location).Path) {
    (Get-Location).Path
  } else {
    $StableRepoDir
  }

  $doctorWslReady = Check-Wsl
  Run-Doctor -RepoDir $doctorRepoDir -WslReady $doctorWslReady

  if ($Script:WarningCount -gt 0) {
    Write-Host "[WARN] Doctor finished with $Script:WarningCount warning(s)." -ForegroundColor Yellow
  }

  exit 0
}

Ensure-WingetPackage -Name 'Git' -WingetId 'Git.Git' -TestScript { Test-Git } -WingetPath $wingetPath
Ensure-WingetPackage -Name 'Node.js LTS' -WingetId 'OpenJS.NodeJS.LTS' -TestScript { (Test-Node) -and (Test-Npm) } -WingetPath $wingetPath
Ensure-WingetPackage -Name 'Python 3.11' -WingetId 'Python.Python.3.11' -TestScript { Test-Python311 } -WingetPath $wingetPath

$wslReady = Check-Wsl
$repoDir = Resolve-RepoDir -WingetPath $wingetPath

Ensure-EnvFile -RepoDir $repoDir

if (-not $LocalWhisperOnly) {
  Run-NpmInstall -RepoDir $repoDir
}

Ensure-LocalWhisperRuntime -RepoDir $repoDir
Launch-App -RepoDir $repoDir -WslReady $wslReady

if ($Script:WarningCount -gt 0) {
  Write-Host "[WARN] Installer finished with $Script:WarningCount warning(s)." -ForegroundColor Yellow
} else {
  Write-Pass 'Installer finished without warnings'
}
