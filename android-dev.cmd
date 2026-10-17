@echo off
rem ZeroNote Android dev launcher -- CRLF required, do not convert to LF
set "PATH=%USERPROFILE%\.cargo\bin;%APPDATA%\npm;%PATH%"
set "CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote"
rem cargo 的 build script 在这台机器上写不了 ~/.cargo（rev63 实测 os error 5 / 183，"按进程的路径拦截"），
rem 所以本机规矩：Android 构建一律把 CARGO_HOME 指到项目外那份可写副本（Documents\deepseek\_cargo-home，1.83 GB，不进 git）。
rem 不带它会构建失败；用 %USERPROFILE% 展开，别写死 C:\Users\AQUA。
set "CARGO_HOME=%USERPROFILE%\Documents\deepseek\_cargo-home"
set "NDK_HOME=%LOCALAPPDATA%\Android\Sdk\ndk\28.2.13676358"
rem 卡死兜底：dev 下默认关掉原生看门狗（dev 的 HMR 空窗会被误判成卡死；生产包不带这个变量 ⇒ 默认开）。
rem 用 `if not defined` 是为了**允许外部覆盖** —— 想在真机上验看门狗时先 `set ZN_WATCHDOG=on`
rem ⚠️ 不能写 `set ZN_WATCHDOG=`：cmd 里那是**删除变量**，等于没覆盖），或 `set ZN_WATCHDOG_DRYRUN=1`。
if not defined ZN_WATCHDOG set "ZN_WATCHDOG=off"
cd /d "%~dp0"
rem 用 tauri.android-dev.json 覆盖 beforeDevCommand —— 安卓这边不再自起 vite，
rem 直接连桌面 dev 已在提供的 devUrl（两端共用同一个服务，开发时要对照）。
rem 之所以要覆盖：tauri.conf.json 的 beforeDevCommand 是全局的，安卓跟着起一个 vite
rem 却抢不到 1420（退到 1421），而手机经局域网/devUrl 连的一直是 1420 —— 那个是白起的。
rem 注意：该 json 里不能写注释（Tauri 的 schema 会拒绝 '//' 这类未知字段）。
rem 前提：桌面 dev（dev.cmd）得开着；开发对照时它一直在。
call pnpm tauri android dev --config tauri.android-dev.json > ".self-logs\android-dev.log" 2>&1
echo EXIT=%ERRORLEVEL% >> ".self-logs\android-dev.log"
