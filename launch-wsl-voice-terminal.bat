@echo off
setlocal

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

call npm start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo WSL Voice Terminal exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
