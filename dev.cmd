@echo off
rem ZeroNote dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
rem -- CDP for automation: Playwright connectOverCDP http://127.0.0.1:9222 --
rem    (dev launcher only; production builds never see it, so no debug port)
rem    NOTE: keep these lines ASCII-only -- cmd treats ">" on a rem line as a redirect.
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"
rem -- 卡死兜底：dev 下关掉原生看门狗 --
rem    理由（实测）：改代码时 vite 连续 hmr update 的空窗会超过 5s 阈值
rem    （2026-10-13 实测一次：连续三次 HMR 后 watchdog 判定 5589ms ⇒ exit 101，白杀一次）。
rem    想观察它的行为用 set "ZN_WATCHDOG_DRYRUN=1"（只留痕、不退出）。
rem    用 `if not defined` 允许外部覆盖（想在 dev 下开看门狗：先 `set ZN_WATCHDOG=on`；
rem    ⚠️ 不能写 `set ZN_WATCHDOG=` —— cmd 里那是删除变量，等于没覆盖）。
if not defined ZN_WATCHDOG set "ZN_WATCHDOG=off"
cd /d "%~dp0"
if not exist ".self-logs" mkdir ".self-logs"
call pnpm tauri dev > ".self-logs\desktop-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\desktop-dev.log"
if errorlevel 1 pause
