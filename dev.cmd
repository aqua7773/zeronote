@echo off
rem ZeroNote dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
rem -- 开发期开 CDP：自动化按选择器/文本操作 WebView，不抢鼠标 --
rem    只写在 dev 启动脚本里，生产打包不经过这里 => 不会开调试端口 --
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"
cd /d "%~dp0"
if not exist ".self-logs" mkdir ".self-logs"
call pnpm tauri dev > ".self-logs\desktop-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\desktop-dev.log"
if errorlevel 1 pause
