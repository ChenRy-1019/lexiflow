@echo off
REM ---------------------------------------------------------------------
REM  LexiFlow launcher
REM
REM  Runs the packaged application. The lexicon.json resource has to sit
REM  next to the executable, so the working directory is set before the
REM  process starts.
REM ---------------------------------------------------------------------
setlocal

set "APP_DIR=%~dp0src-tauri\target\release"
set "APP_EXE=%APP_DIR%\lexiflow.exe"

if not exist "%APP_EXE%" (
    echo.
    echo   LexiFlow has not been built yet.
    echo   Run:  npm run tauri:build
    echo.
    pause
    exit /b 1
)

if not exist "%APP_DIR%\lexicon.json" (
    echo.
    echo   The vocabulary resource is missing.
    echo   Run:  npm run lexicon:build
    echo.
    pause
    exit /b 1
)

cd /d "%APP_DIR%"
REM Start the app detached so this console window closes straight away.
start "LexiFlow" /D "%APP_DIR%" "%APP_EXE%"
endlocal
