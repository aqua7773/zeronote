#requires -Version 5.1
<#
.SYNOPSIS
  把 examples\<id> 的最新代码推到安卓 dev 包的插件目录，并处理「签名失效」。

.DESCRIPTION
  手机 dev 包（默认 com.aqua.zeronote.debug）的插件从应用私有目录读：
    /data/user/0/<包名>/.zn/plugins/<id>/

  这里有三个必做动作，漏一个就**静默失效**（面板不注册，看起来像功能没做）：
    ① 推 manifest.json + entry（index.js / index.cjs）+ styles.css
    ② 文件一变，旧 signature.json 必然验签失败 —— 签名载荷是
       `signingPayload(id, version, entrySha, files)`（src/kernel/plugin-host.ts:322），
       入口文件换了、哈希就变了 ⇒ 拒绝加载。所以推完自动把 signature.json 改名 .bak
       （没有签名文件 = unsigned，照常加载）。
    ③ 推完逐个比对 sha256（手机侧 sha256sum vs 本地 Get-FileHash）

  备份放 `.zn/backups/plugins/<id>-<时间>/` —— **不能**放 `.zn/plugins/` 下，
  否则会被内核当成第二个同 id 插件扫到，同样报「签名无效」（rev173.419 踩过）。

.PARAMETER PluginId
  examples 目录下的插件 id（如 security / sync / private-notes）。

.PARAMETER Package
  目标应用包名，默认 dev 包 com.aqua.zeronote.debug。

.PARAMETER Serial
  adb 设备序列号（多台设备同时连着时必须给）。

.PARAMETER Reload
  推完自动重启应用（force-stop + monkey 拉起），让内核重新扫描插件目录。

.EXAMPLE
  pwsh -File scripts\push-plugin-android.ps1 security

.EXAMPLE
  pwsh -File scripts\push-plugin-android.ps1 sync -Reload
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$PluginId,
  [string]$Package = 'com.aqua.zeronote.debug',
  [string]$Serial = '',
  [switch]$Reload
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$srcDir = Join-Path $root "examples\$PluginId"
$manifestPath = Join-Path $srcDir 'manifest.json'

if (-not (Test-Path $manifestPath)) {
  Write-Error "找不到 $manifestPath —— PluginId 对不对？（examples 下只有这些：$((Get-ChildItem (Join-Path $root 'examples') -Directory).Name -join '、')）"
}

# ── adb 前缀（多设备时必须 -s）──
$adbPrefix = @()
if ($Serial) { $adbPrefix = @('-s', $Serial) }

$devices = (& adb @adbPrefix devices) | Select-String 'device$'
if (-not $devices) {
  Write-Error '没有可用的 adb 设备 —— 先插线并允许 USB 调试'
}

function Invoke-Adb {
  param([string[]]$Arguments)
  $out = & adb @adbPrefix @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Arguments -join ' ') 失败：$out"
  }
  return $out
}

function Invoke-RunAs {
  param([string]$Command)
  return Invoke-Adb @('shell', 'run-as', $Package, $Command)
}

# ── 要推哪些文件：manifest + entry + styles ──
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$files = New-Object System.Collections.Generic.List[string]
$files.Add('manifest.json')

$entry = $manifest.entry
if (-not $entry) { $entry = 'index.js' }
if (Test-Path (Join-Path $srcDir $entry)) {
  $files.Add($entry)
} else {
  Write-Error "manifest 声明的入口 $entry 不存在：$srcDir"
}

# 老插件用 index.cjs，顺手带上（存在且不是 entry 时）
foreach ($extra in @('index.cjs')) {
  if ($extra -ne $entry -and (Test-Path (Join-Path $srcDir $extra))) { $files.Add($extra) }
}
if ($manifest.styles) {
  foreach ($s in $manifest.styles) {
    if (Test-Path (Join-Path $srcDir $s)) { $files.Add($s) }
  }
}

$remoteDir = ".zn/plugins/$PluginId"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = ".zn/backups/plugins/$PluginId-$stamp"
$tmpDir = "/data/local/tmp/zn-push-$PluginId"

Write-Output "▶ $PluginId → $Package（$($files -join '、')）"

# ── 1. 备份现有插件目录（放 .zn/backups/，不放 plugins 下）──
try {
  Invoke-RunAs "mkdir -p .zn/backups/plugins" | Out-Null
  Invoke-RunAs "cp -r $remoteDir $backupDir" | Out-Null
  Write-Output "  · 旧版本已备份到 $backupDir"
} catch {
  Write-Output '  · 没有可备份的旧目录（首次推送）'
}

# ── 2. 推文件：先到 /data/local/tmp，再用 run-as 拷进应用私有目录 ──
Invoke-Adb @('shell', 'rm', '-rf', $tmpDir) | Out-Null
Invoke-Adb @('shell', 'mkdir', '-p', $tmpDir) | Out-Null
foreach ($f in $files) {
  $local = Join-Path $srcDir $f
  Invoke-Adb @('push', $local, "$tmpDir/$f") | Out-Null
}
Invoke-RunAs "mkdir -p $remoteDir" | Out-Null
foreach ($f in $files) {
  Invoke-RunAs "cp $tmpDir/$f $remoteDir/$f" | Out-Null
}
Invoke-Adb @('shell', 'rm', '-rf', $tmpDir) | Out-Null

# ── 3. 签名失效处理：有 signature.json 就改名 .bak（内容变了，旧签名必然不过）──
try {
  Invoke-RunAs "mv $remoteDir/signature.json $remoteDir/signature.json.bak" | Out-Null
  Write-Output '  · signature.json → signature.json.bak（unsigned 照常加载）'
} catch {
  Write-Output '  · 没有 signature.json（已经是 unsigned）'
}

# ── 4. 校验：手机侧 sha256 必须与本地一致 ──
$bad = @()
foreach ($f in $files) {
  $localHash = (Get-FileHash (Join-Path $srcDir $f) -Algorithm SHA256).Hash.ToLower()
  $remoteLine = (Invoke-RunAs "sha256sum $remoteDir/$f") | Out-String
  $remoteHash = ($remoteLine.Trim() -split '\s+')[0]
  if ($remoteHash -ne $localHash) {
    $bad += "$f（本地 $localHash / 手机 $remoteHash）"
  }
}
if ($bad.Count -gt 0) {
  Write-Error "sha256 不一致：`n$($bad -join "`n")"
}
Write-Output "  ✓ $($files.Count) 个文件 sha256 全部一致"

# ── 5. 重启应用让内核重扫插件 ──
if ($Reload) {
  Invoke-Adb @('shell', 'am', 'force-stop', $Package) | Out-Null
  Invoke-Adb @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
  Write-Output '  · 已重启应用（插件目录重新扫描）'
} else {
  Write-Output '  · 别忘了重启应用或 reload 页面，否则跑的还是旧代码（加 -Reload 可自动做）'
}

Write-Output "✅ $PluginId 推送完成"
