@echo off
REM ---------------------------------------------------------------------
REM  LexiFlow development launcher
REM
REM  Starts the Vite dev server and opens the Tauri shell with hot reload.
REM  The Rust side is rebuilt on change; the frontend refreshes in the
REM  browser window.
REM ---------------------------------------------------------------------
setlocal

where cargo >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Cargo was not found on PATH.
    echo   Install Rust from https://rustup.rs and reopen the terminal.
    echo.
    pause
    exit /b 1
)

call npm run tauri:dev
endlocal
