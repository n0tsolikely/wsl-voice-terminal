@echo off
setlocal

set "HIDDEN_LAUNCH=0"
if /I "%~1"=="--run-hidden" (
  set "HIDDEN_LAUNCH=1"
  shift
)

cd /d "%~dp0"

if exist "voice-terminal.env.bat" (
  call "voice-terminal.env.bat"
)

if not exist ".env" if not defined OPENAI_API_KEY (
  echo No OPENAI_API_KEY found. Starting with local faster-whisper transcription fallback.
)

if not exist "package.json" (
  echo Could not find package.json in %CD%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo node_modules is missing. Run npm install first.
  pause
  exit /b 1
)

if "%HIDDEN_LAUNCH%"=="0" if exist "launch-wsl-voice-terminal.vbs" (
  start "" /b wscript.exe "%~dp0launch-wsl-voice-terminal.vbs"
  exit /b 0
)

call npm start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  if "%HIDDEN_LAUNCH%"=="1" (
    powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('WSL Voice Terminal exited with code %EXIT_CODE%. Launch it again from the repo folder to inspect startup errors.','WSL Voice Terminal') | Out-Null"
  ) else (
    echo.
    echo WSL Voice Terminal exited with code %EXIT_CODE%.
    pause
  )
)

exit /b %EXIT_CODE%
