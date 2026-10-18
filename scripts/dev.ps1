# ZeroNote 桌面 dev 一键启动（2026-10-18 rev173.11）
#
# 为什么要这个脚本：
#   WebView2 的用户数据目录默认在 %LOCALAPPDATA%\com.aqua.zeronote\EBWebView。
#   只要这个目录被「管理员权限跑过」的实例碰过，普通权限再启动就会报
#   0x800700AA（请求的资源在使用中）或 0x8000FFFF（灾难性故障）—— 换目录最省事。
#   这里把它指到项目内的 _tmp-ebwebview（已被 .gitignore 的 _tmp-*/ 覆盖）。
#
# 用法：
#   pwsh -File scripts\dev.ps1
#
# 注意：本文件必须是 UTF-8 with BOM（PS 5.1 否则中文乱码，见本机规约）

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $root '_tmp-ebwebview'
Write-Host "WebView2 用户数据目录: $env:WEBVIEW2_USER_DATA_FOLDER"
Push-Location $root
try {
  pnpm tauri dev
} finally {
  Pop-Location
}
