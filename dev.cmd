@echo off
rem ZeroNote dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
cd /d "%~dp0"
call pnpm tauri dev
pause
