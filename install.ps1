[CmdletBinding()]
param(
  [switch]$NoLaunch,
  [switch]$DoctorOnly,
  [switch]$LocalWhisperOnly,
  [switch]$PreferStableRepo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoName = 'wsl-voice-terminal'
$ExpectedRepoUrl = 'https://github.com/n0tsolikely/wsl-voice-terminal.git'
$StableRepoDir = Join-Path $env:USERPROFILE $RepoName
$Script:WarningCount = 0

function Write-Step($Message) {
  Write-Host "[CHECK] $Message" -ForegroundColor Cyan
}

function Write-Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Install($Message) {
  Write-Host "[INSTALL] $Message" -ForegroundColor Cyan
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
    [switch]$IgnoreExitCode,
    [switch]$PassThruExitCode
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if (-not $IgnoreExitCode -and $exitCode -ne 0) {
    throw ("Command failed with exit code {0}: {1} {2}" -f $exitCode, $FilePath, ($Arguments -join ' '))
  }

  if ($PassThruExitCode) {
    return $exitCode
  }
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

function Test-NodePtyDependency([string]$RepoDir) {
  try {
    $packageJson = Get-PackageJson $RepoDir
    return $null -ne $packageJson.dependencies.'node-pty' -or $null -ne $packageJson.optionalDependencies.'node-pty'
  } catch {
    return $false
  }
}

function Test-NodePtyBuild([string]$RepoDir) {
  $ptyBinary = Join-Path $RepoDir 'node_modules\node-pty\build\Release\pty.node'
  return Test-Path $ptyBinary
}

function Get-ElectronRebuildPath([string]$RepoDir) {
  $cmdPath = Join-Path $RepoDir 'node_modules\.bin\electron-rebuild.cmd'
  if (Test-Path $cmdPath) {
    return $cmdPath
  }

  $binPath = Join-Path $RepoDir 'node_modules/.bin/electron-rebuild'
  if (Test-Path $binPath) {
    return $binPath
  }

  return $null
}

function Get-VsWherePath {
  $programFilesX86 = ${env:ProgramFiles(x86)}
  if ($programFilesX86) {
    $candidate = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $vswherePath = Get-CommandPath 'vswhere.exe'
  if (-not $vswherePath) {
    $vswherePath = Get-CommandPath 'vswhere'
  }

  return $vswherePath
}

function Get-FirstStringValue([object]$Value) {
  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [string]) {
    $trimmed = $Value.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
      return $null
    }
    return $trimmed
  }

  if ($Value -is [System.Array]) {
    foreach ($item in $Value) {
      $normalized = Get-FirstStringValue -Value $item
      if ($normalized) {
        return $normalized
      }
    }
    return $null
  }

  $asString = [string]$Value
  if ([string]::IsNullOrWhiteSpace($asString)) {
    return $null
  }
  return $asString.Trim()
}

function Get-NormalizedPathString {
  param(
    [object]$Value,
    [switch]$RequireExisting
  )

  $items = if ($Value -is [System.Array]) { $Value } else { @($Value) }
  $pathLikeFallback = $null

  foreach ($item in $items) {
    $candidate = Get-FirstStringValue -Value $item
    if (-not $candidate) {
      continue
    }
    if ($candidate -match '^\d+$') {
      continue
    }

    if (Test-Path $candidate) {
      return $candidate
    }

    if (-not $pathLikeFallback -and $candidate -match '^[A-Za-z]:\\|^\\\\|^/') {
      $pathLikeFallback = $candidate
    }
  }

  if ($RequireExisting) {
    return $null
  }

  return $pathLikeFallback
}

function New-VsCppState {
  param(
    [bool]$VsInstalled = $false,
    [bool]$ToolsetReady = $false,
    [bool]$CoreFeaturesOnly = $false,
    [string]$Source = $null,
    [string]$Detail = $null
  )

  return [PSCustomObject]@{
    VsInstalled = $VsInstalled
    ToolsetReady = $ToolsetReady
    CoreFeaturesOnly = $CoreFeaturesOnly
    Source = $Source
    Detail = $Detail
  }
}

function New-VsInstallStatus {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Result,
    [bool]$Installed = $false,
    [bool]$AutoInstallAttempted = $false,
    [bool]$InstallCommandSucceeded = $false
  )

  return [PSCustomObject]@{
    Result = $Result
    Installed = $Installed
    ToolsetReady = [bool]$Result.ToolsetReady
    VsInstalled = [bool]$Result.VsInstalled
    CoreFeaturesOnly = [bool]$Result.CoreFeaturesOnly
    AutoInstallAttempted = $AutoInstallAttempted
    InstallCommandSucceeded = $InstallCommandSucceeded
  }
}

function Test-VsCppBuildTools {
  $result = New-VsCppState

  $vswhere = Get-VsWherePath
  if ($vswhere) {
    try {
      $toolsetPath = Get-FirstStringValue -Value (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null)
      if ($toolsetPath) {
        return (New-VsCppState -VsInstalled $true -ToolsetReady $true -Source 'vswhere:toolset' -Detail $toolsetPath)
      }

      $installPath = Get-FirstStringValue -Value (& $vswhere -latest -products * -property installationPath 2>$null)
      if ($installPath) {
        $result.VsInstalled = $true
        $result.Source = 'vswhere'
        $result.Detail = $installPath
      }

      $corePath = Get-FirstStringValue -Value (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.CoreBuildTools -property installationPath 2>$null)
      if ($corePath -and -not $result.ToolsetReady) {
        $result.CoreFeaturesOnly = $true
        if (-not $result.Detail) {
          $result.Detail = $corePath
        }
      }
    } catch {
      # Ignore and fall back to file checks.
    }
  }

  $programFilesX86 = ${env:ProgramFiles(x86)}
  if (-not $programFilesX86) {
    return $result
  }

  $vsRoot = Get-FirstStringValue -Value (Join-Path -Path $programFilesX86 -ChildPath 'Microsoft Visual Studio')
  if (-not $vsRoot) {
    return $result
  }

  $editions = @('BuildTools', 'Community', 'Professional', 'Enterprise')
  foreach ($edition in $editions) {
    $editionRoot = Join-Path -Path $vsRoot -ChildPath ("2022\{0}\VC\Tools\MSVC" -f $edition)
    $pattern = Join-Path -Path $editionRoot -ChildPath '*\bin\Hostx64\x64\cl.exe'
    $match = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      return (New-VsCppState -VsInstalled $true -ToolsetReady $true -Source 'cl.exe' -Detail $match.FullName)
    }
  }

  if ($result.ToolsetReady) {
    return $result
  }

  if (-not $result.VsInstalled) {
    $registryRoots = @(
      'HKLM:\SOFTWARE\Microsoft\VisualStudio\Setup\Instances',
      'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\Setup\Instances'
    )

    foreach ($root in $registryRoots) {
      if (-not (Test-Path $root)) {
        continue
      }

      $instances = Get-ChildItem -Path $root -ErrorAction SilentlyContinue
      foreach ($instance in $instances) {
        try {
          $props = Get-ItemProperty -Path $instance.PSPath -ErrorAction SilentlyContinue
          $installationPath = Get-FirstStringValue -Value $props.InstallationPath
          if ($installationPath) {
            $result.VsInstalled = $true
            $result.Source = 'registry'
            $result.Detail = $installationPath
            return $result
          }
        } catch {
          # Ignore registry read failures.
        }
      }
    }
  }

  return $result
}

function Get-VsCppGuidance {
  return 'Install Visual Studio Build Tools or Visual Studio and include the "Desktop development with C++" workload, then rerun npm install (and npm run rebuild:native if needed).'
}

function Get-VsToolsetMissingFailMessage {
  return 'Visual Studio Build Tools are installed, but the required VC++ toolset is still missing. Install Visual Studio Build Tools with the "Desktop development with C++" workload (or equivalent VC++ components), then rerun install.ps1.'
}

function Install-VsBuildToolsToolset([string]$WingetPath) {
  $overrideArgs = '--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended'
  $arguments = @(
    'install',
    '--id',
    'Microsoft.VisualStudio.2022.BuildTools',
    '--exact',
    '--source',
    'winget',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--override',
    $overrideArgs
  )

  try {
    $exitCode = Invoke-Checked -FilePath $WingetPath -Arguments $arguments -IgnoreExitCode -PassThruExitCode
  } catch {
    return [PSCustomObject]@{
      Succeeded = $false
      ExitCode = $null
      Override = $overrideArgs
      ErrorMessage = $_.Exception.Message
    }
  }

  $succeeded = ($exitCode -eq 0 -or $exitCode -eq 3010)
  return [PSCustomObject]@{
    Succeeded = $succeeded
    ExitCode = $exitCode
    Override = $overrideArgs
    ErrorMessage = $null
  }
}

function Ensure-VsBuildTools([string]$WingetPath) {
  Write-Step 'Checking Visual Studio C++ build tools'
  try {
    $vsCpp = Test-VsCppBuildTools
  } catch {
    Write-Warn 'Visual Studio build tools detection encountered an internal check error. Continuing with guidance-based fallback.'
    $vsCpp = New-VsCppState -Source 'error'
  }

  if ($vsCpp.ToolsetReady) {
    Write-Pass ("Visual Studio C++ build tools detected ({0})" -f $vsCpp.Detail)
    return (New-VsInstallStatus -Result $vsCpp)
  }

  if ($vsCpp.VsInstalled) {
    Write-Warn 'Visual Studio Build Tools are installed, but the required VC++ toolset/workload is missing.'
    if ($vsCpp.CoreFeaturesOnly) {
      Write-Warn 'Visual Studio reports C++ core features, but no usable VC++ toolset for node-gyp.'
    }
  } else {
    Write-Warn 'Visual Studio C++ build tools not detected.'
  }

  Write-Warn 'node-pty requires native compilation on some systems.'
  Write-Warn (Get-VsCppGuidance)

  if (-not $WingetPath) {
    return (New-VsInstallStatus -Result $vsCpp)
  }

  $response = Read-Host 'Install Visual Studio Build Tools now? (y/N)'
  if ($response -notmatch '^(y|yes)$') {
    Write-Warn 'Skipping Visual Studio Build Tools install.'
    return (New-VsInstallStatus -Result $vsCpp)
  }

  Write-Install 'Installing Visual Studio Build Tools with winget'
  $installResult = Install-VsBuildToolsToolset -WingetPath $WingetPath
  if (-not $installResult.Succeeded) {
    Write-Host '[FAIL] Automatic Visual Studio Build Tools installation failed.' -ForegroundColor Red
    if ($null -ne $installResult.ExitCode) {
      Write-Host ("[FAIL] Build Tools installer exit code: {0}" -f $installResult.ExitCode) -ForegroundColor Red
    }
    if ($installResult.ErrorMessage) {
      Write-Warn ("Build Tools install command error: {0}" -f $installResult.ErrorMessage)
    }
    Write-Warn 'Open Visual Studio Build Tools and ensure "Desktop development with C++" (or equivalent VC++ toolset components) is installed, then rerun install.ps1.'
    return (New-VsInstallStatus -Result $vsCpp -Installed $true -AutoInstallAttempted $true -InstallCommandSucceeded $false)
  }

  Write-Warn 'If prompted by the Visual Studio installer UI, keep "Desktop development with C++" selected.'
  Refresh-Path

  try {
    $vsCpp = Test-VsCppBuildTools
  } catch {
    Write-Warn 'Visual Studio build tools detection encountered an internal check error. Continuing with guidance-based fallback.'
    $vsCpp = New-VsCppState -Source 'error'
  }

  if ($vsCpp.ToolsetReady) {
    Write-Pass ("Visual Studio C++ build tools detected ({0})" -f $vsCpp.Detail)
  } elseif ($vsCpp.VsInstalled) {
    Write-Warn 'Visual Studio Build Tools are installed, but the required VC++ toolset/workload is missing.'
  } else {
    Write-Warn 'Visual Studio C++ build tools are still not detected.'
  }

  return (New-VsInstallStatus -Result $vsCpp -Installed $true -AutoInstallAttempted $true -InstallCommandSucceeded $true)
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
      $exitCode = Invoke-Checked -FilePath $pyPath -Arguments @('-3.11', '--version') -IgnoreExitCode -PassThruExitCode
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

  Write-Install "Installing $Name with winget"
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
  $currentDir = Get-NormalizedPathString -Value (Get-Location).Path
  if (-not $currentDir) {
    Stop-Install 'Current working directory path could not be resolved.'
  }

  $stableRepoDir = Get-NormalizedPathString -Value $StableRepoDir
  if (-not $stableRepoDir) {
    Stop-Install 'Stable repo path could not be resolved.'
  }

  if (-not $PreferStableRepo -and (Test-WslVoiceTerminalRepo $currentDir)) {
    Write-Step 'Checking current working directory'
    Write-Pass "Using current repo directory: $currentDir"
    return $currentDir
  }

  if ($PreferStableRepo) {
    Write-Step "PreferStableRepo enabled. Using stable repo path at $stableRepoDir"
  }

  Write-Step "Preparing repo at $stableRepoDir"

  if (-not (Test-Path $stableRepoDir)) {
    $null = Invoke-Checked -FilePath 'git' -Arguments @('clone', $ExpectedRepoUrl, $stableRepoDir)
    $resolvedRepoDir = Get-NormalizedPathString -Value $stableRepoDir -RequireExisting
    if (-not $resolvedRepoDir) {
      Stop-Install 'Repo directory resolution returned an invalid path. Installer output leaked into the path state.'
    }
    Write-Pass "Cloned repo to $resolvedRepoDir"
    return $resolvedRepoDir
  }

  if (-not (Test-Path (Join-Path $stableRepoDir '.git'))) {
    Stop-Install "$stableRepoDir already exists but is not a git clone. Remove or rename that folder, or run install.ps1 from inside your existing repo."
  }

  $originUrl = (& git -C $stableRepoDir remote get-url origin 2>$null).Trim()
  if (-not $originUrl) {
    Stop-Install "The repo at $stableRepoDir has no origin remote. Fix the repo manually or remove the folder and rerun install.ps1."
  }

  if ($originUrl -notmatch 'n0tsolikely/wsl-voice-terminal(?:\.git)?$') {
    Stop-Install "The repo at $stableRepoDir points to $originUrl, not $ExpectedRepoUrl. Remove or fix that repo before rerunning install.ps1."
  }

  $gitStatus = (& git -C $stableRepoDir status --porcelain)
  if ($gitStatus) {
    Write-Warn "The repo at $stableRepoDir has local changes. Skipping git pull to avoid overwriting your work."
    return $stableRepoDir
  }

  $null = Invoke-Checked -FilePath 'git' -Arguments @('-C', $stableRepoDir, 'fetch', 'origin')
  $null = Invoke-Checked -FilePath 'git' -Arguments @('-C', $stableRepoDir, 'checkout', 'main')
  $null = Invoke-Checked -FilePath 'git' -Arguments @('-C', $stableRepoDir, 'pull', '--ff-only', 'origin', 'main')
  Write-Pass "Repo is up to date at $stableRepoDir"

  $resolvedRepoDir = Get-NormalizedPathString -Value $stableRepoDir -RequireExisting
  if (-not $resolvedRepoDir) {
    Stop-Install 'Repo directory resolution returned an invalid path. Installer output leaked into the path state.'
  }

  return $resolvedRepoDir
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
      $exitCode = Invoke-Checked -FilePath $pyPath -Arguments @('-3.11', '--version') -IgnoreExitCode -PassThruExitCode
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

  $requirementsPath = Join-Path $RepoDir 'requirements.local-whisper.txt'

  if (-not (Test-Path $requirementsPath)) {
    Write-Warn 'requirements.local-whisper.txt is missing. Skipping local faster-whisper package install.'
    return
  }

  $pythonCommand = Get-PythonCommand
  if (-not $pythonCommand) {
    Write-Warn 'Python 3.11 is not available. Skipping local faster-whisper setup.'
    return
  }

  $venvDir = Join-Path $RepoDir '.local-whisper-venv'
  $venvPython = Join-Path $venvDir 'Scripts\python.exe'
  $hashPath = Join-Path $venvDir '.requirements.sha256'
  $requirementsHash = (Get-FileHash -Algorithm SHA256 -Path $requirementsPath).Hash

  if (-not (Test-Path $venvPython)) {
    Write-Install "Creating Python virtual environment at $venvDir"
    try {
      Invoke-Checked -FilePath $pythonCommand.FilePath -Arguments ($pythonCommand.Arguments + @('-m', 'venv', $venvDir)) -WorkingDirectory $RepoDir
      Write-Pass 'Created local faster-whisper virtual environment'
    } catch {
      Write-Warn ("Failed to create local faster-whisper venv: {0}" -f $_.Exception.Message)
      return
    }
  } else {
    Write-Pass 'Local faster-whisper virtual environment already exists'
  }

  $existingHash = if (Test-Path $hashPath) { (Get-Content $hashPath -Raw).Trim() } else { $null }
  if ($existingHash -and $existingHash -eq $requirementsHash) {
    Write-Pass 'Local faster-whisper requirements already installed'
    return
  }

  Write-Install 'Installing local faster-whisper requirements'
  try {
    Invoke-Checked -FilePath $venvPython -Arguments @(
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '-r',
      $requirementsPath
    ) -WorkingDirectory $RepoDir
    Set-Content -Path $hashPath -Value $requirementsHash
    Write-Pass 'Local faster-whisper requirements installed'
  } catch {
    Write-Warn ("Local faster-whisper install failed: {0}" -f $_.Exception.Message)
  }
}

function Run-NpmInstall([string]$RepoDir, [string]$WingetPath) {
  if (-not (Test-Npm)) {
    Stop-Install 'npm is not available on PATH. Restart PowerShell after Node.js installs, then rerun install.ps1.'
  }

  $vsInstall = Ensure-VsBuildTools -WingetPath $WingetPath
  if ($null -eq $vsInstall -or -not $vsInstall.PSObject.Properties['Installed']) {
    $fallbackVsState = New-VsCppState -Source 'fallback'
    $vsInstall = New-VsInstallStatus -Result $fallbackVsState
  }

  if ($vsInstall.AutoInstallAttempted -and -not $vsInstall.InstallCommandSucceeded) {
    Stop-Install 'Automatic Visual Studio Build Tools installation failed. Open Visual Studio Build Tools and ensure "Desktop development with C++" (or equivalent VC++ toolset components) is installed, then rerun install.ps1.'
  }

  $nodePtyRequired = Test-NodePtyDependency -RepoDir $RepoDir

  Write-Install 'Running npm install'
  $npmSucceeded = $false

  try {
    Invoke-Checked -FilePath 'npm' -Arguments @('install') -WorkingDirectory $RepoDir
    Write-Pass 'npm install completed'
    $npmSucceeded = $true
  } catch {
    Write-Warn ("npm install failed: {0}" -f $_.Exception.Message)
  }

  if (-not $npmSucceeded -and $vsInstall.Installed -and $vsInstall.ToolsetReady) {
    Write-Install 'Retrying npm install after Visual Studio Build Tools install'
    try {
      Invoke-Checked -FilePath 'npm' -Arguments @('install') -WorkingDirectory $RepoDir
      Write-Pass 'npm install completed'
      $npmSucceeded = $true
    } catch {
      Write-Warn ("npm install retry failed: {0}" -f $_.Exception.Message)
    }
  }

  if (-not $npmSucceeded -and $vsInstall.Installed -and -not $vsInstall.ToolsetReady) {
    Stop-Install (Get-VsToolsetMissingFailMessage)
  }

  $needsRebuild = $false
  if ($nodePtyRequired) {
    if (-not (Test-NodePtyBuild -RepoDir $RepoDir)) {
      $needsRebuild = $true
      Write-Warn 'node-pty native build not detected. Attempting rebuild.'
    }
  }

  if (-not $npmSucceeded -and -not $needsRebuild) {
    $needsRebuild = $true
  }

  if ($needsRebuild) {
    if (Test-PackageScript -RepoDir $RepoDir -ScriptName 'rebuild:native') {
      Write-Install 'Attempting npm run rebuild:native'
      try {
        Invoke-Checked -FilePath 'npm' -Arguments @('run', 'rebuild:native') -WorkingDirectory $RepoDir
        Write-Pass 'rebuild:native completed'
      } catch {
        if (-not $npmSucceeded) {
          Stop-Install ("npm install failed and rebuild:native also failed: {0} {1}" -f $_.Exception.Message, (Get-VsCppGuidance))
        }
        Write-Warn ("rebuild:native failed: {0}" -f $_.Exception.Message)
      }
    } else {
      $rebuildPath = Get-ElectronRebuildPath -RepoDir $RepoDir
      if ($rebuildPath) {
        Write-Install 'Attempting electron-rebuild -f -w node-pty'
        try {
          Invoke-Checked -FilePath $rebuildPath -Arguments @('-f', '-w', 'node-pty') -WorkingDirectory $RepoDir
          Write-Pass 'electron-rebuild completed'
        } catch {
          if (-not $npmSucceeded) {
            Stop-Install ("npm install failed and electron-rebuild also failed: {0} {1}" -f $_.Exception.Message, (Get-VsCppGuidance))
          }
          Write-Warn ("electron-rebuild failed: {0}" -f $_.Exception.Message)
        }
      } elseif (-not $npmSucceeded) {
        Stop-Install ("npm install failed and no rebuild:native script is available. {0}" -f (Get-VsCppGuidance))
      }
    }
  }

  if ($nodePtyRequired) {
    if (Test-NodePtyBuild -RepoDir $RepoDir) {
      Write-Pass 'node-pty native module is ready'
    } else {
      Stop-Install ("node-pty failed to build. {0}" -f (Get-VsCppGuidance))
    }
  }

  if (-not $npmSucceeded -and $vsInstall.VsInstalled -and -not $vsInstall.ToolsetReady) {
    Stop-Install (Get-VsToolsetMissingFailMessage)
  }

  if (-not $npmSucceeded) {
    Stop-Install 'npm install failed. Review the errors above, fix them, and rerun install.ps1.'
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
    Write-Warn 'WSL Voice Terminal was installed, but launch was skipped because wsl.exe is missing. Run wsl --install in an elevated PowerShell window, reboot if required, then rerun install.ps1.'
    return
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

if ($DoctorOnly) {
  Write-Step 'Doctor mode enabled'

  $doctorRepoDir = if (Test-WslVoiceTerminalRepo (Get-Location).Path) {
    (Get-Location).Path
  } else {
    $StableRepoDir
  }

  if ((Test-Path $doctorRepoDir) -and (Test-Node) -and (Test-Path (Join-Path $doctorRepoDir 'scripts\doctor.js'))) {
    Write-Step 'Running scripts/doctor.js'
    Invoke-Checked -FilePath 'node' -Arguments @((Join-Path $doctorRepoDir 'scripts\doctor.js')) -WorkingDirectory $doctorRepoDir -IgnoreExitCode
  } else {
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

    $doctorWslReady = Check-Wsl
    Run-Doctor -RepoDir $doctorRepoDir -WslReady $doctorWslReady
  }

  if ($Script:WarningCount -gt 0) {
    Write-Host ("[WARN] Doctor finished with {0} warning(s)." -f $Script:WarningCount) -ForegroundColor Yellow
  }

  exit 0
}

$wingetPath = Ensure-Winget

Ensure-WingetPackage -Name 'Git' -WingetId 'Git.Git' -TestScript { Test-Git } -WingetPath $wingetPath
Ensure-WingetPackage -Name 'Node.js LTS' -WingetId 'OpenJS.NodeJS.LTS' -TestScript { (Test-Node) -and (Test-Npm) } -WingetPath $wingetPath
Ensure-WingetPackage -Name 'Python 3.11' -WingetId 'Python.Python.3.11' -TestScript { Test-Python311 } -WingetPath $wingetPath

$wslReady = Check-Wsl
$repoDir = Resolve-RepoDir -WingetPath $wingetPath
$repoDir = Get-NormalizedPathString -Value $repoDir -RequireExisting
if (-not $repoDir) {
  Stop-Install 'Repo directory resolution returned an invalid path. Installer output leaked into the path state.'
}

Ensure-EnvFile -RepoDir $repoDir

if (-not $LocalWhisperOnly) {
  Run-NpmInstall -RepoDir $repoDir -WingetPath $wingetPath
}

Ensure-LocalWhisperRuntime -RepoDir $repoDir
Launch-App -RepoDir $repoDir -WslReady $wslReady

if ($Script:WarningCount -gt 0) {
  Write-Host ("[WARN] Installer finished with {0} warning(s)." -f $Script:WarningCount) -ForegroundColor Yellow
} else {
  Write-Pass 'Installer finished without warnings'
}
