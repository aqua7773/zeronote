@echo off
rem ZeroNote dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
cd /d "%~dp0"
if not exist ".self-logs" mkdir ".self-logs"
call pnpm tauri dev > ".self-logs\desktop-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\desktop-dev.log"
if errorlevel 1 pause
