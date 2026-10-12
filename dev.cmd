@echo off
rem ZeroNote dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
rem -- CDP for automation: Playwright connectOverCDP http://127.0.0.1:9222 --
rem    (dev launcher only; production builds never see it, so no debug port)
rem    NOTE: keep these lines ASCII-only -- cmd treats ">" on a rem line as a redirect.
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"
cd /d "%~dp0"
if not exist ".self-logs" mkdir ".self-logs"
call pnpm tauri dev > ".self-logs\desktop-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\desktop-dev.log"
if errorlevel 1 pause
