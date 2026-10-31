/**
 * 应用本体更新的 UI（rev173.292）—— 挂在「设置 → 关于」。
 *
 * 三件事只在这里画：当前版本 / 有没有新版 / 下载进度与安装入口。
 * 检查、下载、安装的全部逻辑在 `kernel/app-update.ts` → Rust `updates.rs`。
 *
 * 平台差异（不是样式差异，是能力差异）：
 *  · **桌面**：官方 updater —— 点「下载并安装」后下载、校验签名、起安装器自动重启；
 *    Windows 上安装器接管时进程会退出，所以界面停在「正在安装」即可，不要指望回调。
 *  · **Android**：下载 APK → 交给系统安装器。多一步「安装未知应用」授权检查 ——
 *    没授权时系统**不弹窗也不报错**，用户会以为点了没反应。
 */

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Download, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  canInstallApk,
  checkAppUpdate,
  downloadAndroidUpdate,
  installApk,
  installDesktopUpdate,
  isAndroidApp,
  isAppAutoCheckEnabled,
  lastCheckedAt,
  markChecked,
  openInstallSettings,
  setAppAutoCheckEnabled,
  type UpdateCheck,
} from '../kernel/app-update'

type Phase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

function fmtSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fmtTime(ms: number): string {
  if (!ms) return '还没检查过'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AppUpdatePanel({ appVersion }: { appVersion?: string }) {
  const android = isAndroidApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [error, setError] = useState<string>('')
  const [downloaded, setDownloaded] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  const [apkPath, setApkPath] = useState<string>('')
  const [canInstall, setCanInstall] = useState<boolean>(true)
  const [autoCheck, setAutoCheck] = useState(() => isAppAutoCheckEnabled())
  const [lastAt, setLastAt] = useState(() => lastCheckedAt())

  const latest = check?.latest ?? null
  const current = check?.currentVersion ?? appVersion ?? '—'

  const runCheck = useCallback(async () => {
    setPhase('checking')
    setError('')
    try {
      const r = await checkAppUpdate()
      markChecked()
      setLastAt(Date.now())
      setCheck(r)
      if (r.error) {
        setError(r.error)
        setPhase('error')
        return
      }
      setPhase(r.hasUpdate && r.latest ? 'available' : 'latest')
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }, [])

  const startInstall = useCallback(async () => {
    if (!latest || !check) return
    setDownloaded(0)
    setTotal(latest.size ?? null)
    setPhase('downloading')
    try {
      if (android) {
        const path = await downloadAndroidUpdate(latest, (p) => {
          setDownloaded(p.downloaded)
          if (p.total) setTotal(p.total)
        })
        setApkPath(path)
        setCanInstall(await canInstallApk())
        setPhase('downloaded')
      } else {
        setPhase('installing')
        await installDesktopUpdate(check.mirror, (p) => {
          setDownloaded(p.downloaded)
          if (p.total) setTotal(p.total)
        })
        // Windows 上这里通常到不了（安装器接管前进程已退出）
        setPhase('installing')
      }
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }, [android, check, latest])

  const doInstallApk = useCallback(async () => {
    try {
      await installApk(apkPath)
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }, [apkPath])

  /* 打开「关于」页时若从未检查过，顺手查一次（不打断：只在 idle 阶段） */
  useEffect(() => {
    if (phase !== 'idle') return
    if (!lastAt) return void runCheck()
  }, [phase, lastAt, runCheck])

  const pct = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null

  const button = (() => {
    const base =
      'rounded-ui-sm border border-border-strong bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50'
    switch (phase) {
      case 'checking':
        return (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> 检查中
          </span>
        )
      case 'downloading':
        return (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {pct === null ? fmtSize(downloaded) : `${pct}%`}
          </span>
        )
      case 'installing':
        return (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> 正在安装
          </span>
        )
      case 'available':
        return (
          <button type="button" className={base} onClick={() => void startInstall()}>
            {android ? '下载安装包' : '下载并安装'}
          </button>
        )
      case 'downloaded':
        return canInstall ? (
          <button type="button" className={base} onClick={() => void doInstallApk()}>
            <Download className="mr-1 inline h-3 w-3" />
            安装
          </button>
        ) : (
          <button type="button" className={base} onClick={() => void openInstallSettings()}>
            <ShieldAlert className="mr-1 inline h-3 w-3" />
            去授权
          </button>
        )
      case 'latest':
        return (
          <button type="button" className={base} onClick={() => void runCheck()}>
            <RefreshCw className="mr-1 inline h-3 w-3" />
            重新检查
          </button>
        )
      case 'error':
        return (
          <button type="button" className={base} onClick={() => void runCheck()}>
            重试
          </button>
        )
      default:
        return (
          <button type="button" className={base} onClick={() => void runCheck()}>
            检查更新
          </button>
        )
    }
  })()

  const hint = (() => {
    if (phase === 'error') {
      // 404 = 清单还没发出去（没过发版流程前都是这个），别把一句话的英文堆给用户
      if (/HTTP 404/.test(error)) return '暂时查不到更新信息（更新清单还没发布，或网络不通）'
      return error || '检查失败'
    }
    if (phase === 'available' && latest) {
      const size = fmtSize(latest.size)
      return [
        `发现新版本 ${latest.version}（当前 ${current}）`,
        size ? `安装包 ${size}` : null,
        latest.pubDate ? `发布于 ${latest.pubDate}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    if (phase === 'downloaded') {
      return canInstall
        ? '已下载完成 · 点「安装」交给系统安装器'
        : '已下载完成，但本应用还没有「安装未知应用」权限 —— 点「去授权」开启后再回来'
    }
    if (phase === 'installing') return '安装器已调起，应用会自动重启'
    if (phase === 'latest') return `已是最新${check?.remoteVersion ? `（远端 ${check.remoteVersion}）` : ''} · 上次检查 ${fmtTime(lastAt)}`
    if (phase === 'checking') return '正在拉更新清单…'
    return `上次检查 ${fmtTime(lastAt)}`
  })()

  return (
    <div className="space-y-2 border-b border-border py-2.5 last:border-b-0">
      <div className="flex flex-col gap-1.5 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between min-[520px]:gap-4">
        <div className="min-w-0 min-[520px]:flex-1">
          <div className="text-xs text-foreground">
            应用更新
            {phase === 'available' && latest ? (
              <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary">
                v{latest.version}
              </span>
            ) : null}
            {phase === 'latest' ? (
              <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-500" />
            ) : null}
          </div>
          <div className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
            {hint}
          </div>
        </div>
        <div className="shrink-0">{button}</div>
      </div>

      {phase === 'downloading' || phase === 'installing' ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: pct === null ? '15%' : `${Math.max(3, pct)}%` }}
          />
        </div>
      ) : null}

      {phase === 'available' && latest?.notes ? (
        <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-ui-sm bg-accent/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {latest.notes}
        </div>
      ) : null}

      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => {
            setAutoCheck(e.target.checked)
            setAppAutoCheckEnabled(e.target.checked)
          }}
          aria-label="启动时检查应用更新"
        />
        启动时最多每 24 小时查一次（只提示，不自动下载）
      </label>
    </div>
  )
}
