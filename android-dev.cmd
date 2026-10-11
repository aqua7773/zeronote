@echo off
rem ZeroNote Android dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
set "NDK_HOME=%LOCALAPPDATA%\Android\Sdk\ndk\28.2.13676358"
rem 桌面 dev 通常已占用 1420，这里让安卓的 dev server 另起一个端口，两边可以同时跑
set "ZN_PORT=1421"
cd /d "%~dp0"
call pnpm tauri android dev > ".self-logs\android-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\android-dev.log"
