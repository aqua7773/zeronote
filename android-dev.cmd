@echo off
rem ZeroNote Android dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
set "NDK_HOME=%LOCALAPPDATA%\Android\Sdk\ndk\28.2.13676358"
cd /d "%~dp0"
call pnpm tauri android dev > ".self-logs\android-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\android-dev.log"
