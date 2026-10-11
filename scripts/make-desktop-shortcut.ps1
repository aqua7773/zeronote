<#
.SYNOPSIS
  为 ZeroNote 创建启动快捷方式（默认放桌面）。
.EXAMPLE
  pwsh -File scripts\make-desktop-shortcut.ps1 -Target "$env:LOCALAPPDATA\ZeroNote\ZeroNote.exe"
.EXAMPLE
  # 放开始菜单
  pwsh -File scripts\make-desktop-shortcut.ps1 -Target "C:\path\ZeroNote.exe" -Where StartMenu
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Name = 'ZeroNote',
  [ValidateSet('Desktop', 'StartMenu')][string]$Where = 'Desktop'
)

if (-not (Test-Path $Target)) { Write-Error "目标不存在：$Target"; exit 1 }

$folder = if ($Where -eq 'Desktop') { [Environment]::GetFolderPath('DesktopDirectory') }
          else { Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs' }
$lnk = Join-Path $folder "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = (Resolve-Path $Target).Path
$sc.WorkingDirectory = Split-Path (Resolve-Path $Target).Path -Parent
$sc.IconLocation = "$((Resolve-Path $Target).Path),0"
$sc.Description = 'ZeroNote —— 空内核的本地 Markdown 笔记应用'
$sc.Save()

[Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
Write-Host "OK  $lnk" -ForegroundColor Green
Write-Host "    -> $((Resolve-Path $Target).Path)"