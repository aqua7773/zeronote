# ZeroNote 一键自检 —— 前端类型 / lint / 内核单测
# 用法：pwsh -File scripts\verify.ps1
# 输出末尾会打印一行「基线」——文档只引用它，不要手写数字。
# 注意：本文件必须是 UTF-8 **with BOM**（PS 5.1 否则中文乱码，见本机规约 §四）

$ErrorActionPreference = 'Continue'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm;" + $env:Path
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$fail = 0

Write-Host '=== 1/4 前端类型检查（tsc -b）===' -ForegroundColor Cyan
pnpm exec tsc -b
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ tsc 失败' -ForegroundColor Red }
else { Write-Host '✅ tsc：0 错误' -ForegroundColor Green }

Write-Host '=== 2/4 前端 lint（oxlint src）===' -ForegroundColor Cyan
$lintOut = (pnpm exec oxlint src 2>&1 | Out-String)
$warn = [regex]::Match($lintOut, 'Found\s+(\d+)\s+warnings?').Groups[1].Value
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ oxlint 失败（有 error）' -ForegroundColor Red }
elseif (-not $warn) { $fail++; Write-Host '❌ oxlint 输出里找不到 warning 数（解析规则要跟着输出格式改）' -ForegroundColor Yellow }
else { Write-Host "✅ oxlint：0 error · $warn warnings（基线 4）" -ForegroundColor Green }

Write-Host '=== 3/4 内核单元测试（cargo test --lib）===' -ForegroundColor Cyan
# 本机铁律：Rust 产物必须在工作区之外
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote"
Push-Location src-tauri
$testOut = (cargo test --lib 2>&1 | Out-String)
$passed = [regex]::Match($testOut, '(\d+)\s+passed').Groups[1].Value
($testOut -split "\r?\n") | Where-Object { $_ -match 'test result|FAILED|panicked' } | Select-Object -Last 6
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ cargo test 失败' -ForegroundColor Red }
elseif (-not $passed) { $fail++; Write-Host '❌ 输出里找不到 passed 数（解析规则要跟着输出格式改）' -ForegroundColor Yellow }
else { Write-Host "✅ cargo test --lib：$passed passed" -ForegroundColor Green }
Pop-Location

Write-Host '=== 4/4 文档一致性（check-docs）===' -ForegroundColor Cyan
node scripts/check-docs.mjs
if ($LASTEXITCODE -ne 0) { $fail++; Write-Host '❌ 文档一致性失败（见上方问题清单）' -ForegroundColor Red }

Pop-Location
Write-Host ''
$w = if ($warn) { $warn } else { '?' }
$p2 = if ($passed) { $passed } else { '?' }
Write-Host "基线：tsc 0 错误 · oxlint $w warnings · cargo test --lib $p2 passed" -ForegroundColor Cyan
if ($fail -gt 0) {
  Write-Host "❌ $fail 项失败（$((Get-Date).ToString('HH:mm:ss'))）" -ForegroundColor Red
  exit 1
}
Write-Host "✅ 全部通过（$((Get-Date).ToString('HH:mm:ss'))）" -ForegroundColor Green
