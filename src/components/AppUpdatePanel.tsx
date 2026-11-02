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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  UPDATE_MIRRORS,
  canInstallApk,
  cancelApkDownload,
  checkAppUpdate,
  downloadAndroidUpdate,
  findApkCache,
  fmtSpeed,
  installApk,
  installDesktopUpdate,
  isAndroidApp,
  isAppAutoCheckEnabled,
  lastCheckedAt,
  loadLastCheck,
  loadUpdateMirror,
  markChecked,
  openInstallSettings,
  probeUpdateMirror,
  saveLastCheck,
  saveUpdateMirror,
  setAppAutoCheckEnabled,
  type PathProbe,
  type RouteProbe,
  type UpdateCheck,
  type UpdateMirror,
} from '../kernel/app-update'
import { compareVersions } from '../kernel/version'

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
  /**
   * 上次检查结果是否**作废**（rev173.324 · 用户：装完新版本还提示「已下载完成 · 安装」、
   * 0.9.9 的 0.9.10 断点续传卡住不刷新）。
   *
   * `loadLastCheck()` 存的是「检查那一刻」的结论，里面 `currentVersion` 是当时的版本。
   * 应用升级后这个值就过期了：面板仍按旧结论铺界面（available / 已下载缓存），
   * 用户看不到「已是最新」，也没有重新检查的入口。判据 = 检查时版本 ≠ 现在版本。
   */
  const isStaleCheck = (c: UpdateCheck | null): boolean =>
    !!c && !!appVersion && c.currentVersion !== appVersion
  /* rev173.311：先把上次的检查结果铺上 —— 关掉设置面板再打开不必重拉一遍清单，
   * 也不会把「发现新版本」这一屏白白丢掉。（rev173.324：过期的结果不铺，回 idle 重新查。） */
  const [check, setCheck] = useState<UpdateCheck | null>(() => {
    const c = loadLastCheck()
    return isStaleCheck(c) ? null : c
  })
  const [phase, setPhase] = useState<Phase>(() => {
    const c = loadLastCheck()
    if (!c || isStaleCheck(c)) return 'idle'
    return c.hasUpdate && c.latest ? 'available' : 'idle'
  })
  const [error, setError] = useState<string>('')
  const [downloaded, setDownloaded] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  const [apkPath, setApkPath] = useState<string>('')
  const [canInstall, setCanInstall] = useState<boolean>(true)
  const [autoCheck, setAutoCheck] = useState(() => isAppAutoCheckEnabled())
  const [lastAt, setLastAt] = useState(() => lastCheckedAt())
  /** 更新渠道（rev173.300）：与插件市场同款下拉 + 测速；存下来下次还用 */
  const [mirror, setMirror] = useState<UpdateMirror>(() => loadUpdateMirror())
  const [probes, setProbes] = useState<PathProbe[] | null>(null)
  const [probing, setProbing] = useState(false)

  /* ── 安装包路径（rev173.311）──
   * 「检查更新」时就把直连 / 两条反代都实测一遍，结果存在 `check.routes` 里。
   * 这里只负责显示与「用户想手动指定走哪条」；默认跟最快的走。 */
  const [routes, setRoutes] = useState<RouteProbe[]>(() => loadLastCheck()?.routes ?? [])
  const [routeId, setRouteId] = useState<string>(() => {
    try {
      return window.localStorage.getItem('zn-app-update-route') ?? ''
    } catch {
      return ''
    }
  })
  /** 断点续传：上次下到一半的字节数（0 = 没有） */
  const [partial, setPartial] = useState(0)

  const latest = check?.latest ?? null
  const current = check?.currentVersion ?? appVersion ?? '—'
  /**
   * 清单里的版本**确实比当前新**吗（rev173.324）。
   *
   * 只看 `check.hasUpdate` 不够 —— 那个值也是检查那一刻算的；应用升级后
   * 清单可能已经是旧版，但缓存里的 APK 还在，面板就永远停在「已下载 · 安装」。
   * 这里用**实际比较**兜底：只有 latest > current 才认缓存 / 断点。
   */
  const latestIsNew = !!latest?.version && compareVersions(latest.version, current) > 0
  /** 缓存/断点只在「确实有更新版」时才算数 —— 派生而不是在 effect 里 setState（避免级联渲染） */
  const effectivePartial = latestIsNew ? partial : 0
  const effectiveApkPath = latestIsNew ? apkPath : ''

  /** 实际要走的下载路径：用户手选优先，否则用实测最快的那条 */
  const chosenRoute = useMemo(() => {
    const usable = routes.filter((r) => r.ok)
    if (usable.length === 0) return null
    if (routeId) return usable.find((r) => r.id === routeId) ?? usable[0]
    return usable[0]
  }, [routes, routeId])

  const runCheck = useCallback(async () => {
    setPhase('checking')
    setError('')
    try {
      const r = await checkAppUpdate(mirror.id)
      markChecked()
      setLastAt(Date.now())
      setCheck(r)
      saveLastCheck(r)
      setRoutes(r.routes ?? [])
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
  }, [mirror.id])

  /** 换渠道：立刻存下来，下次启动检查也用它 */
  const switchMirror = (id: string) => {
    const next = UPDATE_MIRRORS.find((m) => m.id === id)
    if (!next) return
    setMirror(next)
    saveUpdateMirror(next.id)
    setProbes(null)
  }

  /** 依次测各渠道（与插件市场「测速」同款：一条一条显示，不阻塞整页） */
  const probeAll = useCallback(async () => {
    setProbing(true)
    setProbes([])
    const acc: PathProbe[] = []
    for (const m of UPDATE_MIRRORS) {
      try {
        acc.push(await probeUpdateMirror(m.id))
      } catch (e) {
        acc.push({
          id: m.id,
          label: m.label,
          ok: false,
          ms: 0,
          detail: String(e).slice(0, 80),
        })
      }
      setProbes([...acc])
    }
    setProbing(false)
  }, [])

  const startInstall = useCallback(async () => {
    if (!latest || !check) return
    // rev173.334（真人测试8 #2）：关掉面板不会停下载，再点「继续下载」会撞 Rust 并发闸
    // （用户看到「上一次下载还没结束」但进度仍在涨）。先取消旧任务、等它让出闸再发起。
    if (android) {
      try {
        await cancelApkDownload()
      } catch {
        /* 老应用包没有这个命令 ⇒ 照旧继续 */
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    // 断点续传：从上次断的地方显示进度，而不是又从 0 开始
    setDownloaded(effectivePartial)
    setTotal(latest.size ?? null)
    setPhase('downloading')
    // 检查阶段已经测好路了 —— 用户点安装就直接下，不再等一轮测速
    const target = chosenRoute?.url ?? null
    try {
      if (android) {
        const path = await downloadAndroidUpdate(latest, target, (p) => {
          setDownloaded(p.downloaded)
          if (p.total) setTotal(p.total)
        })
        setApkPath(path)
        setPartial(0)
        setCanInstall(await canInstallApk())
        setPhase('downloaded')
      } else {
        setPhase('installing')
        await installDesktopUpdate(check.mirror, target, (p) => {
          setDownloaded(p.downloaded)
          if (p.total) setTotal(p.total)
        })
        // Windows 上这里通常到不了（安装器接管前进程已退出）
        setPhase('installing')
      }
    } catch (e) {
      setError(String(e))
      setPhase('error')
      // 失败后问一下断点落在哪：下次点「继续下载」进度条才从真实位置开始
      if (android) {
        void findApkCache(latest.version).then((c) => {
          if (c.partial > 0) setPartial(c.partial)
        })
      }
    }
  }, [android, check, latest, effectivePartial, chosenRoute])

  const doInstallApk = useCallback(async () => {
    try {
      await installApk(effectiveApkPath)
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }, [effectiveApkPath])

  /* 打开「关于」页时顺手查一次（rev173.324：idle = 没结果或结果已过期，都该重新拉一遍） */
  useEffect(() => {
    if (phase !== 'idle') return
    void runCheck()
  }, [phase, runCheck])

  /* rev173.311：面板一打开就问 Rust「这一版下到哪一步了」。
   *
   * 两种情况以前都要从头来，现在都能捡回来：
   *  · 已经下完（关面板前没点安装）⇒ 直接进「安装」，不再重下 34 MB
   *  · 下到一半（断网 / 切后台）⇒ 记下半成品大小，点下载时从断点续 */
  useEffect(() => {
    if (!android) return
    /* rev173.324：清单版本不高于当前版本（已经是最新 / 应用刚升级过）⇒ 缓存与断点都不再代表
     * 「有包可装」。这里只跳过查询，显示层由 `effectiveApkPath` / `effectivePartial` 兜底 ——
     * 不在 effect 里同步 setState（oxlint `set-state-in-effect`）。 */
    if (!latestIsNew) return
    const v = check?.latest?.version
    if (!v) return
    let alive = true
    void findApkCache(v).then((c) => {
      if (!alive) return
      // 大小对不上 = 上次没下完，别拿半包去装（sha256 仍会在 Rust 侧兜底）
      const want = check?.latest?.size ?? 0
      if (c.path && (want <= 0 || c.size === want)) {
        setApkPath(c.path)
        setPartial(0)
        // 正在下载/安装的不要被覆盖回去
        setPhase((p) => (p === 'downloading' || p === 'installing' ? p : 'downloaded'))
        void canInstallApk().then((ok) => {
          if (alive) setCanInstall(ok)
        })
        return
      }
      if (c.partial > 0) {
        setPartial(c.partial)
        setDownloaded(c.partial)
      }
    })
    return () => {
      alive = false
    }
  }, [android, latestIsNew, check?.latest?.version, check?.latest?.size])

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
          <span className="flex items-center gap-1.5">
            {/* rev173.324：**必须有重新检查入口** —— 以前只有「已是最新」态才能重查，
                卡在旧版的「发现新版本 0.9.10 / 继续下载」时用户无路可走 */}
            <button
              type="button"
              className={base}
              onClick={() => void runCheck()}
              title="重新检查是否有更新的版本"
              aria-label="重新检查更新"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button type="button" className={base} onClick={() => void startInstall()}>
              {android ? (effectivePartial > 0 ? '继续下载' : '下载安装包') : '下载并安装'}
            </button>
          </span>
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
      const pctText =
        effectivePartial > 0 && latest.size
          ? `已下 ${Math.round((effectivePartial / latest.size) * 100)}%，点一下从断点续`
          : null
      return [
        `发现新版本 ${latest.version}（当前 ${current}）`,
        size ? `安装包 ${size}` : null,
        pctText,
        latest.pubDate ? `发布于 ${latest.pubDate}` : null,
        `清单渠道 ${mirror.label}`,
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
    if (phase === 'latest')
      return `已是最新${check?.remoteVersion ? `（远端 ${check.remoteVersion}）` : ''} · 渠道 ${mirror.label} · 上次检查 ${fmtTime(lastAt)}`
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

      {/* 更新渠道（rev173.300）：与插件市场的镜像下拉同款 —— 清单与安装包都从这条渠道走 */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <label htmlFor="zn-app-update-mirror" className="shrink-0">
          更新渠道
        </label>
        <select
          id="zn-app-update-mirror"
          className="rounded-ui-sm border border-border-strong bg-background px-1 py-0.5 text-[11px] text-foreground"
          value={mirror.id}
          onChange={(e) => switchMirror(e.target.value)}
          title="清单与安装包都从这条渠道走 —— jsDelivr 只能镜像清单，安装包在 Release 附件里它拿不到"
        >
          {UPDATE_MIRRORS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-ui-sm border border-border-strong bg-background px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          onClick={() => void probeAll()}
          disabled={probing}
          title="依次测各渠道：能不能拉到真清单（会解析版本），桌面再 HEAD 一下安装包"
        >
          {probing ? '测速中…' : '测速'}
        </button>
      </div>

      {/* 安装包路径（rev173.311）：检查更新时就实测好了，这里让人看得见、也能手选。
          清单渠道管「从哪拉清单」，下载通道管「从哪拉安装包」—— 两件事分开。 */}
      {latest && routes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <label htmlFor="zn-app-update-route" className="shrink-0">
            下载通道
          </label>
          <select
            id="zn-app-update-route"
            className="rounded-ui-sm border border-border-strong bg-background px-1 py-0.5 text-[11px] text-foreground"
            value={routeId}
            onChange={(e) => {
              const next = e.target.value
              setRouteId(next)
              try {
                window.localStorage.setItem('zn-app-update-route', next)
              } catch {
                /* 存不下就只在本次会话生效 */
              }
            }}
            title="检查更新时已经实测过各条路径的速度；默认用最快的那条"
          >
            <option value="">自动（最快）</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.ok}>
                {r.label}
                {r.ok ? ` · ${fmtSpeed(r.bps)}` : ' · 不可用'}
              </option>
            ))}
          </select>
          {chosenRoute ? (
            <span className="text-[10px] text-emerald-600">走 {chosenRoute.label}</span>
          ) : (
            <span className="text-[10px] text-red-500">三条都测不通，下载时会逐条试</span>
          )}
        </div>
      ) : null}

      {probes && probes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {probes.map((p) => (
            <span
              key={p.id}
              className={
                p.ok
                  ? 'rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-600'
                  : 'rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-500'
              }
              title={p.detail}
            >
              {p.label} {p.ok ? `${p.ms}ms` : '✗'} · {p.detail}
            </span>
          ))}
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
