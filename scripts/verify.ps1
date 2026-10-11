# ZeroNote 一键自检 —— 前端类型 / lint / 内核单测
# 用法：pwsh -File scripts\verify.ps1
# 注意：本文件必须是 UTF-8 **with BOM**（PS 5.1 否则中文乱码，见本机规约 §四）

$ErrorActionPreference = 'Continue'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm;" + $env:Path
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$fail = 0

Write-Host '=== 1/3 前端类型检查（tsc）===' -ForegroundColor Cyan
pnpm exec tsc --noEmit -p tsconfig.app.json
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ tsc 失败' -ForegroundColor Red }
else { Write-Host '✅ tsc：0 错误' -ForegroundColor Green }

Write-Host '=== 2/3 前端 lint（oxlint）===' -ForegroundColor Cyan
pnpm exec oxlint
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ oxlint 失败' -ForegroundColor Red }
else { Write-Host '✅ oxlint：0 error' -ForegroundColor Green }

Write-Host '=== 3/3 内核单元测试（cargo test）===' -ForegroundColor Cyan
# 本机铁律：Rust 产物必须在工作区之外
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote"
Push-Location src-tauri
cargo test 2>&1 | Select-Object -Last 14
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ cargo test 失败' -ForegroundColor Red }
else { Write-Host '✅ cargo test：全过' -ForegroundColor Green }
Pop-Location

Pop-Location
if ($fail -gt 0) {
  Write-Host "`n❌ $fail 项失败（$((Get-Date).ToString('HH:mm:ss'))）" -ForegroundColor Red
  exit 1
}
Write-Host "`n✅ 全部通过（$((Get-Date).ToString('HH:mm:ss'))）" -ForegroundColor Green
